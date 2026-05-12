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

// POST — create loan officer
export async function POST(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { full_name, title, email, phone } = await request.json()
  if (!full_name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const { data, error } = await createAdminClient()
    .from('loan_officers')
    .insert({ full_name: full_name.trim(), title: title?.trim() || null, email: email?.trim() || null, phone: phone?.trim() || null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, loanOfficer: data })
}

// PATCH — update loan officer
export async function PATCH(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, full_name, title, email, phone } = await request.json()
  if (!id || !full_name?.trim()) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { error } = await createAdminClient()
    .from('loan_officers')
    .update({ full_name: full_name.trim(), title: title?.trim() || null, email: email?.trim() || null, phone: phone?.trim() || null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// DELETE — remove loan officer (clean up FKs + auth user)
export async function DELETE(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient()

  // Capture the auth_user_id before we lose the row
  const { data: row } = await adminClient
    .from('loan_officers').select('auth_user_id').eq('id', id).single()

  // Null out the FK on any loans referencing this LO so the delete doesn't
  // hit a constraint violation (and so the loans don't end up with a
  // stale FK if the column has no ON DELETE rule)
  await adminClient.from('loans').update({ loan_officer_id: null }).eq('loan_officer_id', id)

  const { error } = await adminClient.from('loan_officers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort: remove the auth user. Don't fail the request if this errors;
  // the loan officer row is already gone.
  if (row?.auth_user_id) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(row.auth_user_id)
    if (authErr) console.error('Failed to delete auth user for loan officer:', authErr.message)
  }

  return NextResponse.json({ success: true })
}
