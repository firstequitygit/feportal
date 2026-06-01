// Reassign a condition to a different role. Shared by admin, LO, LP, UW.
//
// Same access model as /api/conditions/category — any staff with access
// to the parent loan can reassign. Borrowers cannot hit this endpoint
// (the assertNotImpersonating + role check filters them out).
//
// Resetting assigned_to_staff_id to NULL on reassignment is deliberate:
// the staff_id is a pin to a specific person of the previous role, so it
// becomes orphaned the moment you flip the role. Keeping it would leak
// stale data into the badge/name rendering on the condition card.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'

const VALID_ASSIGNEES = ['borrower', 'loan_officer', 'loan_processor', 'underwriter'] as const
type AssignedTo = typeof VALID_ASSIGNEES[number]

function roleLabel(a: AssignedTo): string {
  switch (a) {
    case 'borrower':       return 'Borrower'
    case 'loan_officer':   return 'Loan Officer'
    case 'loan_processor': return 'Loan Processor'
    case 'underwriter':    return 'Underwriter'
  }
}

export async function PATCH(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  // Resolve every staff role the user holds in parallel.
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

  const { conditionId, assignedTo } = await req.json()
  if (!conditionId) return NextResponse.json({ error: 'Missing conditionId' }, { status: 400 })
  if (!VALID_ASSIGNEES.includes(assignedTo)) {
    return NextResponse.json({ error: 'Invalid assignedTo' }, { status: 400 })
  }

  const { data: condition } = await adminClient
    .from('conditions')
    .select('id, loan_id, title, assigned_to')
    .eq('id', conditionId)
    .single()
  if (!condition) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Loan-access check for non-admins. Ops manager LPs bypass.
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

  // No-op when already on the requested assignee — saves a write + a
  // confusing "reassigned from X to X" event row.
  if (condition.assigned_to === assignedTo) {
    return NextResponse.json({ success: true, noop: true })
  }

  const { error } = await adminClient
    .from('conditions')
    .update({ assigned_to: assignedTo, assigned_to_staff_id: null })
    .eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit log. Use the staff role's full_name for the byline so the log
  // matches the convention from /api/loan-officer/conditions etc.
  const actor =
    (admin ? 'Admin' : null) ??
    (lo?.full_name as string | undefined) ??
    (lp?.full_name as string | undefined) ??
    (uw?.full_name as string | undefined) ??
    'Staff'
  try {
    await adminClient.from('loan_events').insert({
      loan_id: condition.loan_id,
      event_type: 'condition_reassigned',
      description: `${actor} reassigned "${condition.title}" from ${roleLabel(condition.assigned_to as AssignedTo)} to ${roleLabel(assignedTo)}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
