import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyContactAccess } from '@/lib/contact-access'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

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

  // Borrower-assigned conditions can be responded to by the borrower OR by
  // the broker on the loan (when one is assigned). Any other assignee is
  // staff-only.
  if (condition.assigned_to && condition.assigned_to !== 'borrower') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const access = await verifyContactAccess(user.id, condition.loan_id)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Resolve the responder's display name for the audit log
  let responderName = ''
  let responderRole = 'Borrower'
  if (access.role === 'broker' && access.brokerId) {
    responderRole = 'Broker'
    const { data: b } = await adminClient.from('brokers').select('full_name, email').eq('id', access.brokerId).single()
    responderName = b?.full_name ?? b?.email ?? ''
  } else if (access.borrowerId) {
    const { data: b } = await adminClient.from('borrowers').select('full_name').eq('id', access.borrowerId).single()
    responderName = b?.full_name ?? ''
  }

  const { error } = await adminClient
    .from('conditions')
    .update({ response: response.trim(), status: 'Received' })
    .eq('id', conditionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: condition.loan_id,
      event_type: 'condition_response',
      description: `${responderRole} ${responderName} responded to "${condition.title}": ${response.trim()}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
