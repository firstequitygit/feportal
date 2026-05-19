import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { squareClient, feeCentsForBorrowerCount } from '@/lib/square'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!rateLimit(`pay:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: { resumeToken?: string; cardToken?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.resumeToken || !body.cardToken) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const admin = createAdminClient()
  const { data: app } = await admin
    .from('loan_applications')
    .select('id, status, data, resume_email')
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
      idempotencyKey: `card:${app.id}`,
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

    return NextResponse.json({ success: true, feeCents, last4: c.last4 ?? null, brand: c.cardBrand ?? null })
  } catch (e) {
    console.error('Square card-on-file failed:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Could not save card. Please re-check your card details.' }, { status: 502 })
  }
}
