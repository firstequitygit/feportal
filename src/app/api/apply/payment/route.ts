import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { squareClient, feeCentsForBorrowerCount, chargeApplicationFee } from '@/lib/square'
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
    const sq = squareClient()
    const cust = await sq.customers.create({
      idempotencyKey: `customer:${app.id}`,
      emailAddress: app.resume_email ?? undefined,
      note: `Loan application ${app.id}`,
    })
    const customerId = cust.customer?.id
    if (!customerId) throw new Error('No customer id')

    const card = await sq.cards.create({
      idempotencyKey: `card:${shortHash(body.cardToken)}`,
      sourceId: body.cardToken,
      card: { customerId },
    })
    const c = card.card
    if (!c?.id) throw new Error('No card id')

    const { error: updErr } = await admin.from('loan_applications').update({
      square_customer_id: customerId,
      square_card_id: c.id,
      card_brand: c.cardBrand ?? null,
      card_last4: c.last4 ?? null,
      fee_amount_cents: feeCents,
    }).eq('id', app.id)
    if (updErr) throw new Error(`Persist card-on-file failed: ${updErr.message}`)

    const brand = c.cardBrand ?? null
    const last4 = c.last4 ?? null
    const squareCardId = c.id

    // Idempotent guard: if fee was already charged (e.g. user navigated back and resubmitted),
    // skip the charge and return immediately.
    if (app.fee_charged_at) {
      return NextResponse.json({ success: true, charged: true, alreadyCharged: true, brand, last4, feeCents })
    }

    // Atomic claim: flip status to 'charging' only if the fee is uncharged AND the
    // status is a claimable one (null or 'declined'). This is a conditional UPDATE,
    // so two concurrent submissions cannot both win the claim.
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
        // Another request charged it - idempotent success.
        return NextResponse.json({ success: true, charged: true, alreadyCharged: true, brand, last4, feeCents })
      }
      // Status is 'charging' or 'needs_review' - in flight or under review; not retryable inline.
      return NextResponse.json({ success: true, charged: false, reason: 'in_review', brand, last4, feeCents })
    }

    const chargeResult = await chargeApplicationFee({
      squareCustomerId: customerId,
      squareCardId,
      feeAmountCents: feeCents,
      idempotencyKey: `charge:${app.id}:${squareCardId}`,
      note: `Credit & Background Check - loan application ${app.id}`,
    })

    if (chargeResult.ok) {
      // Charge succeeded - record it. If the persist fails, money was still taken:
      // fall back to needs_review and log loudly, but still report charged:true.
      const { error: persistErr } = await admin.from('loan_applications').update({
        fee_charged_at: new Date().toISOString(),
        fee_charge_status: 'charged',
      }).eq('id', app.id)
      if (persistErr) {
        const paymentId = (chargeResult.payment as { id?: string } | null)?.id ?? 'unknown'
        console.error(
          `CRITICAL: charge SUCCEEDED but persist FAILED (apply/payment) app=${app.id} squarePaymentId=${paymentId}:`,
          persistErr.message,
        )
        await admin.from('loan_applications').update({ fee_charge_status: 'needs_review' }).eq('id', app.id)
      }
      // No loan exists yet at this point (pre-submission), so skip loan_events.
      return NextResponse.json({ success: true, charged: true, brand, last4, feeCents })
    }

    if (chargeResult.declined) {
      // Card was declined - release the claim back to 'declined' (retryable), let submission proceed.
      await admin.from('loan_applications').update({
        fee_charge_status: 'declined',
      }).eq('id', app.id)
      return NextResponse.json({ success: true, charged: false, reason: 'declined', brand, last4, feeCents })
    }

    // Hard/network error - the charge may have gone through. Mark needs_review (do NOT
    // leave 'charging', do NOT mark retryable) and report a non-retryable error.
    console.error('Square charge error (apply/payment):', chargeResult.message)
    await admin.from('loan_applications').update({
      fee_charge_status: 'needs_review',
    }).eq('id', app.id)
    return NextResponse.json({ success: true, charged: false, reason: 'error', brand, last4, feeCents })
  } catch (e) {
    console.error('Square card-on-file failed:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Could not save card. Please re-check your card details.' }, { status: 502 })
  }
}
