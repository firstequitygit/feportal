import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanRoleForUser } from '@/lib/loan-authorization'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: loanId } = await params

  const adminClient = createAdminClient()
  const role = await getLoanRoleForUser(adminClient, loanId, user.id)
  if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let query = adminClient
    .from('documents')
    .select('id, file_name, file_path, file_size, uploaded_by_user_id, created_at')
    .eq('loan_id', loanId)
    .is('condition_id', null)
    .order('created_at', { ascending: false })

  if (role.role === 'borrower') {
    query = query.eq('uploaded_by_user_id', user.id)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ documents: data ?? [] })
}
