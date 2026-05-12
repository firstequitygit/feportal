import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: admin } = await supabase.from('admin_users').select('id').eq('auth_user_id', user.id).single()
  return admin ? user : null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  if (!await requireAdmin(supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { full_name, title, email, phone } = await req.json()
  if (!full_name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const { data, error } = await createAdminClient()
    .from('underwriters')
    .insert({ full_name: full_name.trim(), title: title || null, email: email || null, phone: phone || null })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, underwriter: data })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  if (!await requireAdmin(supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, full_name, title, email, phone } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await createAdminClient()
    .from('underwriters')
    .update({ full_name, title: title || null, email: email || null, phone: phone || null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  if (!await requireAdmin(supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const adminClient = createAdminClient()

  const { data: row } = await adminClient
    .from('underwriters').select('auth_user_id').eq('id', id).single()

  await adminClient.from('loans').update({ underwriter_id: null }).eq('underwriter_id', id)

  const { error } = await adminClient.from('underwriters').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (row?.auth_user_id) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(row.auth_user_id)
    if (authErr) console.error('Failed to delete auth user for underwriter:', authErr.message)
  }

  return NextResponse.json({ success: true })
}
