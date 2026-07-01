import { NextRequest, NextResponse, after } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { squareClient, feeCentsForBorrowerCount, chargeApplicationFee } from '@/lib/square'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** First 16 hex chars of sha256 - keeps Square idempotency keys under the 45-char cap. */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

/** Capture the borrower's signature + save card-on-file for the application
 *  fee, then flip the loan's authorization_status to 'signed'. Token-auth
 *  (the URL is the auth). Idempotent for already-signed loans. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!rateLimit(`authz:ip:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const { token } = await ctx.params
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  // Token-scoped limit so a spoofed X-Forwarded-For cannot bypass the IP limit and
  // to bound Square customer/card creation abuse against a single authorize link.
  if (!rateLimit(`authz:tok:${token}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { authSignature?: string; paymentSignature?: string; saveCardAgree?: boolean; cardToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.authSignature || !body.paymentSignature) {
    return NextResponse.json({ error: 'Both signatures are required' }, { status: 400 })
  }
  if (!body.saveCardAgree) {
    return NextResponse.json({ error: 'Card-save authorization is required' }, { status: 400 })
  }
  if (!body.cardToken) {
    return NextResponse.json({ error: 'Card token is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: loan } = await admin
    .from('loans')
    .select('id, authorization_status, application_kind, submitted_by_broker_id')
    .eq('authorize_token', token)
    .maybeSingle()
  if (!loan) return NextResponse.json({ error: 'Authorization link not found' }, { status: 404 })

  // Find the loan_applications row so we can persist the card-on-file under
  // the existing application-side columns and merge the signatures into
  // loan_applications.data for the PDF / audit trail.
  const { data: app } = await admin
    .from('loan_applications')
    .select('id, data, resume_email, fee_charged_at')
    .eq('submitted_loan_id', loan.id)
    .maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application record missing' }, { status: 500 })

  // Idempotent fast-path: only short-circuit when the authorization is already
  // signed AND the fee is collected. If the fee is still uncollectable we must
  // fall through and re-attempt the charge (the status flip below is a no-op).
  if (loan.authorization_status === 'signed' && app.fee_charged_at) {
    return NextResponse.json({ success: true, alreadySigned: true, charged: true })
  }

  const data = (app.data ?? {}) as Record<string, unknown>
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as unknown[]) : []
  const borrowerCount = 1 + cobs.length
  const feeCents = feeCentsForBorrowerCount(borrowerCount)

  let squareCustomerId: string | null = null
  let squareCardId: string | null = null
  let cardBrand: string | null = null
  let cardLast4: string | null = null
  try {
    const sq = squareClient()
    const cust = await sq.customers.create({
      idempotencyKey: `customer:authz:${app.id}`,
      emailAddress: app.resume_email ?? undefined,
      note: `Loan ${loan.id} (authorize)`,
    })
    squareCustomerId = cust.customer?.id ?? null
    if (!squareCustomerId) throw new Error('No Square customer id')
  } catch (err) {
    console.error('Authorize Square customer setup failed:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Could not process payment. Please re-check your card details.' }, { status: 502 })
  }

  // Persist the Square customer id + fee amount + merge signatures into the JSONB blob.
  // We no longer save a card-on-file (a just-created card is not chargeable for
  // several seconds due to eventual consistency); brand/last4/square_card_id are set
  // from the PAYMENT response after a successful direct-nonce charge below.
  const mergedData = {
    ...data,
    auth_signature: body.authSignature,
    payment_signature: body.paymentSignature,
    save_card_agree: true,
  }
  const { error: appErr } = await admin
    .from('loan_applications')
    .update({
      data: mergedData,
      square_customer_id: squareCustomerId,
      fee_amount_cents: feeCents,
    })
    .eq('id', app.id)
  if (appErr) {
    console.error('Authorize: persist loan_applications failed:', appErr.message)
    return NextResponse.json({ error: 'Could not finalize authorization' }, { status: 500 })
  }

  // Attempt to charge the application fee. A decline must NOT block authorization.
  // The status flip happens regardless of charge outcome.
  let chargedResult: { charged: boolean; reason?: string } = { charged: false, reason: 'skipped' }

  if (app.fee_charged_at) {
    // Idempotent guard: fee already charged (e.g. borrower refreshed and resubmitted).
    chargedResult = { charged: true }
  } else if (squareCustomerId) {
    // Atomic claim: flip status to 'charging' only if uncharged AND claimable
    // (null or 'declined'). A conditional UPDATE prevents a double-charge across
    // concurrent retries of the same authorize link.
    const { data: claimed } = await admin
      .from('loan_applications')
      .update({ fee_charge_status: 'charging' })
      .eq('id', app.id)
      .is('fee_charged_at', null)
      .or('fee_charge_status.is.null,fee_charge_status.eq.declined')
      .select('id')
      .maybeSingle()

    if (!claimed) {
      // Lost the claim. Re-read to resolve the real outcome.
      const { data: fresh } = await admin
        .from('loan_applications')
        .select('fee_charged_at')
        .eq('id', app.id)
        .maybeSingle()
      if (fresh?.fee_charged_at) {
        chargedResult = { charged: true }
      } else {
        // 'charging' (in flight) or 'needs_review' - not retryable inline.
        chargedResult = { charged: false, reason: 'in_review' }
      }
    } else {
      // Charge the card nonce/token DIRECTLY. A nonce is instantly chargeable (no
      // eventual-consistency lag like a just-created card-on-file). Token-scoped
      // idempotency key: new nonce on retry -> new key (fresh attempt); same nonce ->
      // same key (Square dedupes) -> double-charge-safe.
      const chargeRes = await chargeApplicationFee({
        squareCustomerId,
        sourceId: body.cardToken,
        feeAmountCents: feeCents,
        idempotencyKey: `charge:${app.id}:${shortHash(body.cardToken)}`,
        note: `Credit & Background Check - loan application ${app.id} (loan ${loan.id})`,
      })

      if (chargeRes.ok) {
        // Charge succeeded. Pull brand/last4 + the payment id from the PAYMENT
        // response (payment result is typed `unknown`, so narrow carefully).
        const payment = chargeRes.payment as {
          id?: string
          cardDetails?: { card?: { cardBrand?: string; last4?: string } }
        } | null
        cardBrand = payment?.cardDetails?.card?.cardBrand ?? null
        cardLast4 = payment?.cardDetails?.card?.last4 ?? null
        // Repurpose square_card_id to hold the Square PAYMENT id (no reusable
        // card-on-file anymore; a payment id is still a valid Square ref).
        squareCardId = payment?.id ?? null
        // If the persist fails, money was still taken: fall back to needs_review
        // and log loudly, but still report charged:true.
        const { error: persistErr } = await admin.from('loan_applications').update({
          fee_charged_at: new Date().toISOString(),
          fee_charge_status: 'charged',
          card_brand: cardBrand,
          card_last4: cardLast4,
          square_card_id: squareCardId,
        }).eq('id', app.id)
        if (persistErr) {
          console.error(
            `CRITICAL: charge SUCCEEDED but persist FAILED (authorize) app=${app.id} squarePaymentId=${squareCardId ?? 'unknown'}:`,
            persistErr.message,
          )
          await admin.from('loan_applications').update({ fee_charge_status: 'needs_review' }).eq('id', app.id)
        }
        chargedResult = { charged: true }
      } else if (chargeRes.declined) {
        // Release the claim back to 'declined' (retryable).
        await admin.from('loan_applications').update({
          fee_charge_status: 'declined',
        }).eq('id', app.id)
        chargedResult = { charged: false, reason: 'declined' }
      } else {
        // Hard/network error - charge may have gone through. Mark needs_review
        // (do NOT leave 'charging', do NOT mark retryable).
        console.error('Square charge error (authorize):', chargeRes.message)
        await admin.from('loan_applications').update({
          fee_charge_status: 'needs_review',
        }).eq('id', app.id)
        chargedResult = { charged: false, reason: 'error' }
      }
    }
  }

  // Flip the loan's authorization status. Use the Square payment id (held in
  // squareCardId after a successful charge; null if declined/errored) as the
  // payment reference. Flip REGARDLESS of charge outcome.
  const { error: loanErr } = await admin
    .from('loans')
    .update({
      authorization_status: 'signed',
      authorization_signed_at: new Date().toISOString(),
      authorization_payment_ref: squareCardId,
    })
    .eq('id', loan.id)
  if (loanErr) {
    console.error('Authorize: persist loans failed:', loanErr.message)
    return NextResponse.json({ error: 'Could not finalize authorization' }, { status: 500 })
  }

  // Audit (best-effort).
  after(async () => {
    try {
      await admin.from('loan_events').insert({
        loan_id: loan.id,
        event_type: 'authorization_signed',
        description: `Borrower completed /authorize (card last4 ${cardLast4 ?? '?'})`,
      })
      if (chargedResult.charged) {
        await admin.from('loan_events').insert({
          loan_id: loan.id,
          event_type: 'fee_charged',
          description: `Credit & Background Check fee charged: $${(feeCents / 100).toFixed(2)}`,
        })
      }
    } catch (err) {
      console.error('Authorize audit insert failed:', err)
    }
  })

  return NextResponse.json({
    success: true,
    last4: cardLast4,
    brand: cardBrand,
    charged: chargedResult.charged,
    ...(chargedResult.reason != null ? { reason: chargedResult.reason } : {}),
  })
}
