import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { documentId } = await req.json()
  if (!documentId) return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })

  const adminClient = createAdminClient()

  // Fetch the document to get file_path and loan_id
  const { data: doc } = await adminClient
    .from('documents')
    .select('id, file_path, loan_id, file_name')
    .eq('id', documentId)
    .single()

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  // Check if the authenticated user is the LO, LP, or UW on this loan
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
    .eq('id', doc.loan_id)
    .single()

  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  // Resolve which role this user holds
  const [{ data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('loan_officers').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', user.id).single(),
  ])

  const authorized =
    (lo && loan.loan_officer_id === lo.id) ||
    (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) ||
    (uw && loan.underwriter_id === uw.id)

  if (!authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Delete from Supabase Storage
  const { error: storageError } = await adminClient.storage
    .from('documents')
    .remove([doc.file_path])

  if (storageError) {
    console.error('Storage delete error:', storageError.message)
    // Continue — remove the DB record even if storage fails
  }

  // Delete the DB record
  const { error: dbError } = await adminClient
    .from('documents')
    .delete()
    .eq('id', documentId)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  // Log event
  try {
    const actor = lo ? 'Loan Officer' : lp ? 'Loan Processor' : 'Underwriter'
    await adminClient.from('loan_events').insert({
      loan_id: doc.loan_id,
      event_type: 'document_deleted',
      description: `${actor} deleted document: "${doc.file_name}"`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ success: true })
}
