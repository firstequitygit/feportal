import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lp } = await adminClient
    .from('loan_processors')
    .select('id, full_name')
    .eq('auth_user_id', user.id)
    .single()
  if (!lp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  // Up to 2 LPs per loan. Fill the first open slot; reject if both
  // already filled or if this LP is already assigned.
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, loan_processor_id, loan_processor_id_2, property_address')
    .eq('id', loanId)
    .single()

  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id) {
    return NextResponse.json({ error: 'You are already assigned to this loan' }, { status: 409 })
  }
  const slot: 'loan_processor_id' | 'loan_processor_id_2' | null =
    !loan.loan_processor_id   ? 'loan_processor_id' :
    !loan.loan_processor_id_2 ? 'loan_processor_id_2' :
    null
  if (!slot) return NextResponse.json({ error: 'This loan already has 2 loan processors assigned' }, { status: 409 })

  const { error } = await adminClient
    .from('loans')
    .update({ [slot]: lp.id })
    .eq('id', loanId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'loan_processor_assigned',
      description: `Loan processor ${lp.full_name} self-assigned to this loan`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
