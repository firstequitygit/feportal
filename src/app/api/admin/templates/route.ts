import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  return !!admin
}

const VALID_CATEGORIES = ['initial', 'underwriting', 'pre_close', 'pre_funding']
const VALID_ASSIGNEES = ['borrower', 'loan_officer', 'loan_processor', 'underwriter']

// POST — create a template
export async function POST(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, description, loan_type, category, assigned_to } = await request.json()
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const safeCategory = VALID_CATEGORIES.includes(category) ? category : null
  const safeAssignee = VALID_ASSIGNEES.includes(assigned_to) ? assigned_to : 'borrower'

  const { data, error } = await createAdminClient()
    .from('condition_templates')
    .insert({
      title: title.trim(),
      description: description?.trim() || null,
      loan_type: loan_type || null,
      category: safeCategory,
      assigned_to: safeAssignee,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, template: data })
}

// PATCH — update a template
export async function PATCH(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, title, description, loan_type, category, assigned_to } = await request.json()
  if (!id || !title?.trim()) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const safeCategory = VALID_CATEGORIES.includes(category) ? category : null
  const safeAssignee = VALID_ASSIGNEES.includes(assigned_to) ? assigned_to : 'borrower'

  const { error } = await createAdminClient()
    .from('condition_templates')
    .update({
      title: title.trim(),
      description: description?.trim() || null,
      loan_type: loan_type || null,
      category: safeCategory,
      assigned_to: safeAssignee,
    })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// DELETE — remove a template
export async function DELETE(request: Request) {
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await createAdminClient()
    .from('condition_templates')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
