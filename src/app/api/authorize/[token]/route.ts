import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { squareClient, feeCentsForBorrowerCount, chargeApplicationFee } from '@/lib/square'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** Capture the borrower's signature + save card-on-file for the application
 *  fee, then flip the loan's authorization_status to 'signed'. Token-auth
 *  (the URL is the auth). Idempotent for already-signed loans. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!rateLimit(`authorize:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const { token } = await ctx.params
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

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
  if (loan.authorization_status === 'signed') {
    return NextResponse.json({ success: true, alreadySigned: true })
  }

  // Find the loan_applications row so we can persist the card-on-file under
  // the existing application-side columns and merge the signatures into
  // loan_applications.data for the PDF / audit trail.
  const { data: app } = await admin
    .from('loan_applications')
    .select('id, data, resume_email, fee_charged_at')
    .eq('submitted_loan_id', loan.id)
    .maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application record missing' }, { status: 500 })

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

    const card = await sq.cards.create({
      idempotencyKey: `card:authz:${app.id}`,
      sourceId: body.cardToken,
      card: { customerId: squareCustomerId },
    })
    squareCardId = card.card?.id ?? null
    cardBrand = card.card?.cardBrand ?? null
    cardLast4 = card.card?.last4 ?? null
    if (!squareCardId) throw new Error('No Square card id')
  } catch (err) {
    console.error('Authorize card save failed:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Could not save card. Please re-check your card details.' }, { status: 502 })
  }

  // Persist card-on-file fields on loan_applications + merge signatures into the JSONB blob.
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
      square_card_id: squareCardId,
      card_brand: cardBrand,
      card_last4: cardLast4,
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
  } else if (squareCardId && squareCustomerId) {
    const chargeRes = await chargeApplicationFee({
      squareCustomerId,
      squareCardId,
      feeAmountCents: feeCents,
      idempotencyKey: `charge:${app.id}:${squareCardId}`,
      note: `Credit & Background Check - loan application ${app.id} (loan ${loan.id})`,
    })

    if (chargeRes.ok) {
      await admin.from('loan_applications').update({
        fee_charged_at: new Date().toISOString(),
        fee_charge_status: 'charged',
      }).eq('id', app.id)
      chargedResult = { charged: true }
    } else if (chargeRes.declined) {
      await admin.from('loan_applications').update({
        fee_charge_status: 'declined',
      }).eq('id', app.id)
      chargedResult = { charged: false, reason: 'declined' }
    } else {
      // Hard/network error - leave fee_charge_status unchanged; retryable.
      console.error('Square charge error (authorize):', chargeRes.message)
      chargedResult = { charged: false, reason: 'error' }
    }
  }

  // Flip the loan's authorization status. Use the square card id as the
  // payment reference so we have a stable link between the loan and the
  // saved card. Flip REGARDLESS of charge outcome.
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
