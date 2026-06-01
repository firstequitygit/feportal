// Toggle a condition's is_urgent flag. Shared by admin, LO, LP, UW.
//
// Same access model as /api/conditions/category and /api/conditions/assign.
// When set, the loan's underwriter receives an email the moment the
// condition status transitions into 'Received' (see notify-urgent-received).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'

export async function PATCH(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name, is_ops_manager').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])

  const isAdmin = !!admin
  const isOpsManager = Boolean((lp as { is_ops_manager?: boolean } | null)?.is_ops_manager)
  if (!isAdmin && !lo && !lp && !uw) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { conditionId, isUrgent } = await req.json()
  if (!conditionId) return NextResponse.json({ error: 'Missing conditionId' }, { status: 400 })
  if (typeof isUrgent !== 'boolean') {
    return NextResponse.json({ error: 'isUrgent must be a boolean' }, { status: 400 })
  }

  const { data: condition } = await adminClient
    .from('conditions')
    .select('id, loan_id, title, is_urgent')
    .eq('id', conditionId)
    .single()
  if (!condition) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Loan access check for non-admins. Ops manager LPs bypass.
  if (!isAdmin && !isOpsManager) {
    const { data: loan } = await adminClient
      .from('loans')
      .select('loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
      .eq('id', condition.loan_id)
      .single()
    if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // No-op when the value isn't actually changing — keeps the audit log
  // free of "marked urgent → marked urgent" rows.
  if (condition.is_urgent === isUrgent) {
    return NextResponse.json({ success: true, noop: true })
  }

  const { error } = await adminClient
    .from('conditions')
    .update({ is_urgent: isUrgent })
    .eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const actor =
    (admin ? 'Admin' : null) ??
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    'Staff'

  try {
    await adminClient.from('loan_events').insert({
      loan_id: condition.loan_id,
      event_type: 'condition_urgency_changed',
      description: isUrgent
        ? `${actor} marked "${condition.title}" as URGENT`
        : `${actor} removed urgent flag from "${condition.title}"`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
