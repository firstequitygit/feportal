import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: uw } = await adminClient
    .from('underwriters')
    .select('id, full_name')
    .eq('auth_user_id', user.id)
    .single()
  if (!uw) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, underwriter_id')
    .eq('id', loanId)
    .single()

  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
  if (loan.underwriter_id !== uw.id) {
    return NextResponse.json({ error: 'You are not the assigned underwriter on this loan' }, { status: 403 })
  }

  const { error } = await adminClient
    .from('loans')
    .update({ underwriter_id: null })
    .eq('id', loanId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'underwriter_unassigned',
      description: `Underwriter ${uw.full_name} released this loan`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
