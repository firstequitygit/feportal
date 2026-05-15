import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Assign or clear the broker on a loan. Callable by admin, LO, or LP
// (matching the invite-broker permission model). UW is read-only — they
// don't assign contacts.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const [{ data: admin }, { data: lo }, { data: lp }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', user.id).single(),
  ])
  if (!admin && !lo && !lp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, brokerId } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  // Non-admins must be assigned to this loan
  if (!admin) {
    const { data: loan } = await adminClient
      .from('loans')
      .select('id, loan_officer_id, loan_processor_id, loan_processor_id_2')
      .eq('id', loanId)
      .single()
    if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const hasAccess =
      (lo && loan.loan_officer_id === lo.id) ||
      (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id))
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Validate broker exists (when assigning)
  let brokerName: string | null = null
  if (brokerId) {
    const { data: broker } = await adminClient
      .from('brokers').select('id, full_name, email').eq('id', brokerId).single()
    if (!broker) return NextResponse.json({ error: 'Broker not found' }, { status: 404 })
    brokerName = broker.full_name ?? broker.email
  }

  const { error } = await adminClient
    .from('loans').update({ broker_id: brokerId || null }).eq('id', loanId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: brokerId ? 'broker_assigned' : 'broker_unassigned',
      description: brokerId
        ? `Broker ${brokerName} assigned to this loan`
        : `Broker unassigned from this loan`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
