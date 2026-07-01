import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { feeCentsForBorrowerCount, chargeApplicationFee } from '@/lib/square'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** First 16 hex chars of sha256 - keeps Square idempotency keys under the 45-char cap. */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`pay:ip:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { resumeToken?: string; cardToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken || !body.cardToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  // Token-scoped limit so a spoofed X-Forwarded-For cannot bypass the IP limit and
  // to bound Square customer/card creation abuse on a single application.
  if (!rateLimit(`pay:tok:${body.resumeToken}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const admin = createAdminClient()
  const { data: app } = await admin
    .from('loan_applications')
    .select('id, status, data, resume_email, fee_charged_at')
    .eq('resume_token', body.resumeToken)
    .maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  if (app.status === 'submitted') return NextResponse.json({ error: 'Already submitted' }, { status: 409 })

  const data = (app.data ?? {}) as Record<string, unknown>
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as unknown[]) : []
  const borrowerCount = 1 + cobs.length
  const feeCents = feeCentsForBorrowerCount(borrowerCount)

  try {
    // Persist the fee amount up front.
    await admin.from('loan_applications').update({ fee_amount_cents: feeCents }).eq('id', app.id)

    // Idempotent guard: if fee was already charged (e.g. user navigated back and resubmitted),
    // skip the charge and return immediately.
    if (app.fee_charged_at) {
      return NextResponse.json({ success: true, charged: true, alreadyCharged: true, brand: null, last4: null, feeCents })
    }

    // Atomic claim: flip status to 'charging' only if the fee is uncharged AND the
    // status is a claimable one (null or 'declined'). Conditional UPDATE, so two
    // concurrent submissions cannot both win the claim.
    const { data: claimed } = await admin
      .from('loan_applications')
      .update({ fee_charge_status: 'charging' })
      .eq('id', app.id)
      .is('fee_charged_at', null)
      .or('fee_charge_status.is.null,fee_charge_status.eq.declined')
      .select('id')
      .maybeSingle()

    if (!claimed) {
      const { data: fresh } = await admin
        .from('loan_applications').select('fee_charged_at').eq('id', app.id).maybeSingle()
      if (fresh?.fee_charged_at) {
        return NextResponse.json({ success: true, charged: true, alreadyCharged: true, brand: null, last4: null, feeCents })
      }
      return NextResponse.json({ success: true, charged: false, reason: 'in_review', brand: null, last4: null, feeCents })
    }

    // Charge the card token (nonce) DIRECTLY - NO customer, NO saved card-on-file. A
    // just-created Square customer/card is not usable for a few seconds (eventual
    // consistency); that lag was landing good cards in needs_review. A raw payment token
    // has no such dependency and is immediately chargeable. Token-scoped idempotency key
    // keeps retries double-charge-safe (same nonce -> dedupe; new nonce -> fresh attempt).
    const chargeResult = await chargeApplicationFee({
      sourceId: body.cardToken,
      feeAmountCents: feeCents,
      idempotencyKey: `charge:${app.id}:${shortHash(body.cardToken)}`,
      note: `Credit & Background Check - loan application ${app.id}`,
    })

    if (chargeResult.ok) {
      // Charge succeeded - record it (brand/last4/payment id come from the payment
      // response; square_card_id now holds the payment reference). If the persist fails,
      // money was still taken: fall back to needs_review and log loudly.
      const payment = chargeResult.payment as {
        id?: string
        cardDetails?: { card?: { cardBrand?: string; last4?: string } }
      } | null
      const brand = payment?.cardDetails?.card?.cardBrand ?? null
      const last4 = payment?.cardDetails?.card?.last4 ?? null
      const paymentId = payment?.id ?? null
      const { error: persistErr } = await admin.from('loan_applications').update({
        fee_charged_at: new Date().toISOString(),
        fee_charge_status: 'charged',
        card_brand: brand,
        card_last4: last4,
        square_card_id: paymentId,
      }).eq('id', app.id)
      if (persistErr) {
        console.error(
          `CRITICAL: charge SUCCEEDED but persist FAILED (apply/payment) app=${app.id} squarePaymentId=${paymentId ?? 'unknown'}:`,
          persistErr.message,
        )
        await admin.from('loan_applications').update({ fee_charge_status: 'needs_review' }).eq('id', app.id)
      }
      return NextResponse.json({ success: true, charged: true, brand, last4, feeCents })
    }

    if (chargeResult.declined) {
      await admin.from('loan_applications').update({ fee_charge_status: 'declined' }).eq('id', app.id)
      return NextResponse.json({ success: true, charged: false, reason: 'declined', brand: null, last4: null, feeCents })
    }

    console.error('Square charge error (apply/payment):', chargeResult.message)
    await admin.from('loan_applications').update({ fee_charge_status: 'needs_review' }).eq('id', app.id)
    return NextResponse.json({ success: true, charged: false, reason: 'error', brand: null, last4: null, feeCents })
  } catch (e) {
    console.error('Square payment failed (apply/payment):', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Could not process payment. Please re-check your card details.' }, { status: 502 })
  }
}
