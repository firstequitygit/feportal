import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: uw } = await adminClient
    .from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!uw) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  const { data: loan } = await adminClient
    .from('loans').select('id, underwriter_id, pipeline_stage, property_address').eq('id', loanId).single()

  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (loan.underwriter_id) return NextResponse.json({ error: 'This loan has already been claimed' }, { status: 409 })
  if (loan.pipeline_stage === 'New Application') {
    return NextResponse.json({ error: 'Underwriters can only claim loans after the New Application stage' }, { status: 403 })
  }

  const { error } = await adminClient
    .from('loans').update({ underwriter_id: uw.id }).eq('id', loanId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'underwriter_assigned',
      description: `Underwriter ${uw.full_name} self-assigned to this loan`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
