import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { chargeApplicationFee } from '@/lib/square'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: isAdmin } = await admin.from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isAdmin.is_super) return NextResponse.json({ error: 'Super-admin required to charge cards' }, { status: 403 })

  const { data: app } = await admin
    .from('loan_applications')
    .select('id, square_customer_id, square_card_id, fee_amount_cents, fee_charged_at')
    .eq('submitted_loan_id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'No application linked to this loan' }, { status: 404 })
  if (app.fee_charged_at) return NextResponse.json({ error: 'Fee already charged' }, { status: 409 })
  if (!app.square_customer_id || !app.square_card_id || !app.fee_amount_cents)
    return NextResponse.json({ error: 'No saved card on file' }, { status: 400 })

  const result = await chargeApplicationFee({
    squareCustomerId: app.square_customer_id,
    squareCardId: app.square_card_id,
    feeAmountCents: app.fee_amount_cents,
    idempotencyKey: `charge:${app.id}:${app.square_card_id}`,
    note: `Credit & Background Check - loan ${id}`,
  })

  if (!result.ok) {
    console.error('Square charge failed:', result.message)
    return NextResponse.json({ error: 'Charge failed - see Square dashboard' }, { status: 502 })
  }

  const { error: updErr } = await admin
    .from('loan_applications')
    .update({ fee_charged_at: new Date().toISOString(), fee_charge_status: 'charged' })
    .eq('id', app.id)
  if (updErr) {
    console.error('Persist fee_charged_at failed:', updErr.message)
    return NextResponse.json({ error: 'Charge succeeded but failed to persist - check Square dashboard' }, { status: 500 })
  }
  try {
    await admin.from('loan_events').insert({
      loan_id: id, event_type: 'fee_charged',
      description: `Credit & Background Check fee charged: $${(app.fee_amount_cents / 100).toFixed(2)}`,
    })
  } catch (logErr) {
    console.error('Audit log failed (fee_charged):', logErr instanceof Error ? logErr.message : logErr)
  }
  return NextResponse.json({ success: true, amount: app.fee_amount_cents })
}
