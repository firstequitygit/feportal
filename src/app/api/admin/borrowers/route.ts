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

// DELETE a borrower record. Removes the row from `borrowers` (loans get their
// borrower_id set to null via FK cascade) AND deletes the Supabase auth user
// if one is linked, so they can no longer log in.
export async function DELETE(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient()

  // Grab the auth_user_id before deletion so we can delete from auth too
  const { data: borrower } = await adminClient
    .from('borrowers').select('auth_user_id, email').eq('id', id).maybeSingle()
  if (!borrower) return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })

  const { error } = await adminClient.from('borrowers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Delete the auth user too (so the email can't sign in anymore). If this
  // fails we don't undo the row deletion — the row delete is the primary
  // outcome the admin asked for, and an orphan auth user can be cleaned up
  // out-of-band if needed.
  if (borrower.auth_user_id) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(borrower.auth_user_id)
    if (authErr) console.error('Borrower auth delete error:', authErr.message)
  }

  return NextResponse.json({ success: true })
}
