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

export async function POST(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { full_name, title, email, phone } = await request.json()
  if (!full_name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const { data, error } = await createAdminClient()
    .from('loan_processors')
    .insert({ full_name: full_name.trim(), title: title?.trim() || null, email: email?.trim() || null, phone: phone?.trim() || null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, loanProcessor: data })
}

export async function PATCH(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, full_name, title, email, phone } = await request.json()
  if (!id || !full_name?.trim()) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { error } = await createAdminClient()
    .from('loan_processors')
    .update({ full_name: full_name.trim(), title: title?.trim() || null, email: email?.trim() || null, phone: phone?.trim() || null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient()

  const { data: row } = await adminClient
    .from('loan_processors').select('auth_user_id').eq('id', id).single()

  await adminClient.from('loans').update({ loan_processor_id: null }).eq('loan_processor_id', id)

  const { error } = await adminClient.from('loan_processors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (row?.auth_user_id) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(row.auth_user_id)
    if (authErr) console.error('Failed to delete auth user for loan processor:', authErr.message)
  }

  return NextResponse.json({ success: true })
}
