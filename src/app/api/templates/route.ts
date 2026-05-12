import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function verifyAccess() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const adminClient = createAdminClient()

  const [{ data: admin }, { data: uw }, { data: lp }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', user.id).single(),
  ])

  return !!(admin || uw || lp)
}

export async function POST(req: NextRequest) {
  if (!await verifyAccess()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, description, loan_type, assigned_to, category } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const { data, error } = await createAdminClient()
    .from('condition_templates')
    .insert({ title: title.trim(), description: description?.trim() || null, loan_type: loan_type || null, assigned_to: assigned_to || 'borrower', category: category || null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, template: data })
}

export async function PATCH(req: NextRequest) {
  if (!await verifyAccess()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, title, description, loan_type, assigned_to, category } = await req.json()
  if (!id || !title?.trim()) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { error } = await createAdminClient()
    .from('condition_templates')
    .update({ title: title.trim(), description: description?.trim() || null, loan_type: loan_type || null, assigned_to: assigned_to || 'borrower', category: category || null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  if (!await verifyAccess()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await createAdminClient()
    .from('condition_templates')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
