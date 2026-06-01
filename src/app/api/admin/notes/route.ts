import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { processMentions } from '@/lib/process-mentions'

// Mirrors the CHECK constraint in 20260529-loan-notes-category.sql.
// Kept here too so the route rejects unknown categories with a clean
// 400 rather than letting Postgres throw a constraint violation.
const NOTE_CATEGORIES = ['loan_officer', 'processor', 'underwriter', 'closer'] as const

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  return admin ? user : null
}

export async function POST(request: Request) {
  const block = await assertNotImpersonating()
  if (block) return block
  const user = await verifyAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, content, category, mentions } = await request.json()
  if (!loanId || !content?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  // Default to loan_officer to match the column default — keeps backward
  // compatibility with any caller that doesn't yet send a category.
  const safeCategory = NOTE_CATEGORIES.includes(category) ? category : 'loan_officer'

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('loan_notes')
    .insert({
      loan_id: loanId,
      content: content.trim(),
      created_by: user.email ?? 'Admin',
      category: safeCategory,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fire-and-forget mention pipeline. Failures here are logged but
  // never fail the note write — the message is already saved.
  if (Array.isArray(mentions) && mentions.length > 0 && data?.id) {
    try {
      await processMentions({
        adminClient,
        authorName: user.email ?? 'Admin',
        loanId,
        sourceKind: 'staff_note',
        sourceId: data.id,
        text: content,
        mentions,
      })
    } catch (err) { console.error('processMentions failed:', err) }
  }

  return NextResponse.json({ success: true, note: data })
}

export async function DELETE(request: Request) {
  const block = await assertNotImpersonating()
  if (block) return block
  if (!await verifyAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { noteId } = await request.json()
  if (!noteId) return NextResponse.json({ error: 'Missing noteId' }, { status: 400 })

  const adminClient = createAdminClient()
  const { error } = await adminClient.from('loan_notes').delete().eq('id', noteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
