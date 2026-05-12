import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: borrower } = await adminClient
    .from('borrowers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!borrower) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { conditionId, response } = await req.json()
  if (!conditionId || !response?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { data: condition } = await adminClient
    .from('conditions')
    .select('id, loan_id, title, assigned_to')
    .eq('id', conditionId)
    .single()
  if (!condition) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Borrower can only respond to conditions on their own loan that are assigned to them
  if (condition.assigned_to && condition.assigned_to !== 'borrower') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: loan } = await adminClient
    .from('loans').select('id').eq('id', condition.loan_id).eq('borrower_id', borrower.id).single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await adminClient
    .from('conditions')
    .update({ response: response.trim(), status: 'Received' })
    .eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: condition.loan_id,
      event_type: 'condition_response',
      description: `Borrower ${borrower.full_name ?? ''} responded to "${condition.title}": ${response.trim()}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
