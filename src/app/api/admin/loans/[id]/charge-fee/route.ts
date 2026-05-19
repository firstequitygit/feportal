import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { squareClient, SQUARE_LOCATION_ID } from '@/lib/square'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: isAdmin } = await admin.from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: app } = await admin
    .from('loan_applications')
    .select('id, square_customer_id, square_card_id, fee_amount_cents, fee_charged_at')
    .eq('submitted_loan_id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'No application linked to this loan' }, { status: 404 })
  if (app.fee_charged_at) return NextResponse.json({ error: 'Fee already charged' }, { status: 409 })
  if (!app.square_customer_id || !app.square_card_id || !app.fee_amount_cents)
    return NextResponse.json({ error: 'No saved card on file' }, { status: 400 })

  try {
    const sq = squareClient()
    // Square v44: payments.create() returns HttpResponsePromise<CreatePaymentResponse> (extends Promise<T>).
    // Awaiting unwraps directly to CreatePaymentResponse, so pay.payment?.status is correct.
    // amountMoney.amount must be BigInt per v44 Money type.
    const pay = await sq.payments.create({
      idempotencyKey: randomUUID(),
      sourceId: app.square_card_id,
      customerId: app.square_customer_id,
      locationId: SQUARE_LOCATION_ID(),
      amountMoney: { amount: BigInt(app.fee_amount_cents), currency: 'USD' },
      note: `Credit & Background Check — loan ${id}`,
    })
    const status = pay.payment?.status
    if (status !== 'COMPLETED' && status !== 'APPROVED')
      throw new Error(`Square status ${status ?? 'unknown'}`)

    const { error: updErr } = await admin.from('loan_applications').update({ fee_charged_at: new Date().toISOString() }).eq('id', app.id)
    if (updErr) throw new Error(`Persist fee_charged_at failed: ${updErr.message}`)
    await admin.from('loan_events').insert({
      loan_id: id, event_type: 'fee_charged',
      description: `Credit & Background Check fee charged: $${(app.fee_amount_cents / 100).toFixed(2)}`,
    })
    return NextResponse.json({ success: true, amount: app.fee_amount_cents })
  } catch (e) {
    console.error('Square charge failed:', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'Charge failed — see Square dashboard' }, { status: 502 })
  }
}
