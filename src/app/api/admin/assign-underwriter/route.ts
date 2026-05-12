import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, underwriterId } = await req.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  const adminClient = createAdminClient()

  const { error } = await adminClient
    .from('loans')
    .update({ underwriter_id: underwriterId ?? null })
    .eq('id', loanId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch underwriter name for the event log
  let uwName = 'Unassigned'
  if (underwriterId) {
    const { data: uw } = await adminClient
      .from('underwriters').select('full_name').eq('id', underwriterId).single()
    if (uw) uwName = uw.full_name
  }

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'underwriter_assigned',
      description: underwriterId
        ? `Underwriter assigned: ${uwName}`
        : 'Underwriter removed',
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
