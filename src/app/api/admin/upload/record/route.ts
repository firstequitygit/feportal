import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Records an admin-uploaded document in the database
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, conditionId, fileName, fileSize, path } = await req.json()
  if (!loanId || !conditionId || !fileName || !path) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: condition } = await adminClient
    .from('conditions').select('title').eq('id', conditionId).single()

  const { error } = await adminClient.from('documents').insert({
    loan_id: loanId,
    condition_id: conditionId,
    file_name: fileName,
    file_path: path,
    file_size: fileSize ?? null,
  })

  if (error) {
    return NextResponse.json({ error: 'Could not save document: ' + error.message }, { status: 500 })
  }

  // Log event
  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'document_uploaded',
      description: `Admin uploaded document for "${condition?.title ?? 'condition'}": ${fileName}`,
    })
  } catch (err) {
    console.error('Event log error:', err)
  }

  return NextResponse.json({ success: true })
}
