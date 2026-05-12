import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  return admin ? user : null
}

export async function DELETE(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId } = await request.json()
  if (!loanId) return NextResponse.json({ error: 'Missing loanId' }, { status: 400 })

  const adminClient = createAdminClient()

  // Step 1: Fetch all document file paths for this loan
  const { data: documents } = await adminClient
    .from('documents')
    .select('file_path')
    .eq('loan_id', loanId)

  // Step 2: Delete files from Supabase Storage
  if (documents && documents.length > 0) {
    const filePaths = documents.map(d => d.file_path)
    const { error: storageError } = await adminClient.storage
      .from('documents')
      .remove(filePaths)

    if (storageError) {
      console.error('Storage delete error:', storageError.message)
      // Continue anyway — don't block loan deletion if storage fails
    }
  }

  // Step 3: Delete related records (in order to avoid FK constraint issues)
  await adminClient.from('documents').delete().eq('loan_id', loanId)
  await adminClient.from('conditions').delete().eq('loan_id', loanId)
  await adminClient.from('loan_notes').delete().eq('loan_id', loanId)
  await adminClient.from('loan_events').delete().eq('loan_id', loanId)

  // Step 4: Delete the loan itself
  const { error } = await adminClient.from('loans').delete().eq('id', loanId)

  if (error) {
    console.error('Loan delete error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
