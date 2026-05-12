import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id, full_name').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single(),
  ])

  if (!admin && !lo && !lp && !uw) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, phone } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, borrower_id, loan_officer_id, loan_processor_id, underwriter_id')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (!loan.borrower_id) return NextResponse.json({ error: 'No borrower assigned to this loan' }, { status: 400 })

  // Non-admins must be assigned to this loan
  if (!admin) {
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && loan.loan_processor_id === lp.id) ||
      (uw && loan.underwriter_id === uw.id)
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const trimmed = typeof phone === 'string' ? phone.trim() : ''

  const { error } = await adminClient
    .from('borrowers')
    .update({ phone: trimmed || null })
    .eq('id', loan.borrower_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    const editorName =
      (lo?.full_name as string | undefined) ??
      (lp?.full_name as string | undefined) ??
      (uw?.full_name as string | undefined) ??
      (admin ? 'Admin' : null)

    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'borrower_phone_updated',
      description: trimmed
        ? `Borrower phone set to ${trimmed}${editorName ? ` by ${editorName}` : ''}`
        : `Borrower phone cleared${editorName ? ` by ${editorName}` : ''}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
