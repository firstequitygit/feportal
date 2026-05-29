import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanRoleForUser, canBulkUpload } from '@/lib/loan-authorization'
import { suggestConditionId } from '@/lib/match-condition'

type IncomingFile = { fileName: string; fileSize: number | null; path: string }

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { loanId, files } = (await req.json()) as { loanId?: string; files?: IncomingFile[] }
  if (!loanId || !Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: 'Missing loanId or files' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const role = await getLoanRoleForUser(adminClient, loanId, user.id)
  if (!canBulkUpload(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = files.map(f => ({
    loan_id: loanId,
    condition_id: null,
    uploaded_by_user_id: user.id,
    file_name: f.fileName,
    file_path: f.path,
    file_size: f.fileSize ?? null,
  }))

  const { data: inserted, error } = await adminClient
    .from('documents')
    .insert(rows)
    .select('id, file_name, file_path, file_size, created_at')

  if (error || !inserted) {
    return NextResponse.json({ error: `Insert failed: ${error?.message}` }, { status: 500 })
  }

  const { data: conditions } = await adminClient
    .from('conditions')
    .select('id, title')
    .eq('loan_id', loanId)

  const safeConditions = conditions ?? []
  const documents = inserted.map(d => ({
    ...d,
    suggested_condition_id: suggestConditionId(d.file_name, safeConditions),
  }))

  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'documents_bulk_uploaded',
      description: `${role!.role} bulk-uploaded ${inserted.length} document(s) (unmatched)`,
    })
  } catch (err) { console.error('Event log error:', err) }

  return NextResponse.json({ documents })
}
