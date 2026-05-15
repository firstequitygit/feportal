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

// DELETE a broker record. Removes the row from `brokers` (loans get their
// broker_id set to null via FK cascade — the borrower becomes the contact
// again) AND deletes the Supabase auth user if one is linked.
export async function DELETE(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient()

  const { data: broker } = await adminClient
    .from('brokers').select('auth_user_id, email').eq('id', id).maybeSingle()
  if (!broker) return NextResponse.json({ error: 'Broker not found' }, { status: 404 })

  const { error } = await adminClient.from('brokers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (broker.auth_user_id) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(broker.auth_user_id)
    if (authErr) console.error('Broker auth delete error:', authErr.message)
  }

  return NextResponse.json({ success: true })
}
