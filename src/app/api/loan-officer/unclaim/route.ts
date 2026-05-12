import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Release a loan officer's claim on a loan. Only the LO who currently
 * holds the assignment can unclaim it (admins use the assignment dropdown
 * on the admin loan page instead).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lo } = await adminClient
    .from('loan_officers')
    .select('id, full_name')
    .eq('auth_user_id', user.id)
    .single()
  if (!lo) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, loan_officer_id')
    .eq('id', loanId)
    .single()

  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (loan.loan_officer_id !== lo.id) {
    return NextResponse.json({ error: 'You are not the assigned loan officer on this loan' }, { status: 403 })
  }

  const { error } = await adminClient
    .from('loans')
    .update({ loan_officer_id: null })
    .eq('id', loanId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'loan_officer_unassigned',
      description: `Loan officer ${lo.full_name} released this loan`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
