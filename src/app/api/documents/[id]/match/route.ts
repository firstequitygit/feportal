import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanRoleForUser } from '@/lib/loan-authorization'
import { setConditionReceived } from '@/lib/condition-set-received'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { condition_id } = await req.json() as { condition_id: string | null }

  const adminClient = createAdminClient()

  const { data: doc } = await adminClient
    .from('documents')
    .select('id, loan_id, uploaded_by_user_id, condition_id')
    .eq('id', id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const role = await getLoanRoleForUser(adminClient, doc.loan_id, user.id)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Borrowers can only match documents they uploaded.
  if (role.role === 'borrower' && doc.uploaded_by_user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // If setting a condition_id, verify it belongs to this loan.
  if (condition_id !== null) {
    const { data: condition } = await adminClient
      .from('conditions')
      .select('id, loan_id, title, status')
      .eq('id', condition_id)
      .maybeSingle()
    if (!condition || condition.loan_id !== doc.loan_id) {
      return NextResponse.json({ error: 'Condition not on this loan' }, { status: 400 })
    }
    // Flip condition status from Outstanding/Rejected to Received, matching existing upload-record behavior.
    // setConditionReceived also fires the urgent-received email when applicable.
    if (condition.status === 'Outstanding' || condition.status === 'Rejected') {
      await setConditionReceived({ adminClient, conditionId: condition.id })
    }
  }

  const { error } = await adminClient
    .from('documents')
    .update({ condition_id })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await adminClient.from('loan_events').insert({
      loan_id: doc.loan_id,
      event_type: condition_id ? 'document_matched' : 'document_unmatched',
      description: condition_id
        ? `${role.role} matched document ${id} to condition ${condition_id}`
        : `${role.role} un-matched document ${id}`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
