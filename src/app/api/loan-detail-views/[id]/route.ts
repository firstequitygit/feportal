// Per-view operations.
//
//   PATCH  → update name / hiddenFields / isDefault (partial allowed)
//   DELETE → remove the view entirely
//
// Owner-only: a user can only mutate their own views. The route
// joins on user_id implicitly via the WHERE clause so a stolen id
// from another user just returns 404.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { LOAN_DETAILS_FIELD_KEYS } from '@/lib/loan-details-fields'

function sanitizeHiddenFields(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const v of input) {
    if (typeof v === 'string' && LOAN_DETAILS_FIELD_KEYS.has(v)) out.push(v)
  }
  return Array.from(new Set(out))
}

async function requireStaffUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const adminClient = createAdminClient()
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', user.id).single(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', user.id).single(),
  ])
  if (!admin && !lo && !lp && !uw) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user, adminClient }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const block = await assertNotImpersonating()
  if (block) return block
  const ctx = await requireStaffUser()
  if ('error' in ctx) return ctx.error
  const { user, adminClient } = ctx
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => null) as
    | { name?: string; hiddenFields?: unknown; isDefault?: boolean }
    | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim()
    if (!trimmed) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    if (trimmed.length > 80) return NextResponse.json({ error: 'Name too long (max 80 chars)' }, { status: 400 })
    update.name = trimmed
  }
  if (body.hiddenFields !== undefined) {
    update.hidden_fields = sanitizeHiddenFields(body.hiddenFields)
  }

  // Two-step default flip — clear any prior default first so the
  // partial unique index doesn't reject. Only do this when isDefault
  // is explicitly true; passing false clears the default on this row
  // without touching the others.
  if (body.isDefault === true) {
    await adminClient.from('loan_detail_views')
      .update({ is_default: false })
      .eq('user_id', user.id)
      .eq('is_default', true)
      .neq('id', id)
    update.is_default = true
  } else if (body.isDefault === false) {
    update.is_default = false
  }

  const { data, error } = await adminClient
    .from('loan_detail_views')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, name, hidden_fields, is_default, created_at, updated_at')
    .single()

  if (error) {
    if (/unique/i.test(error.message)) {
      return NextResponse.json({ error: 'You already have a view with that name' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ view: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const block = await assertNotImpersonating()
  if (block) return block
  const ctx = await requireStaffUser()
  if ('error' in ctx) return ctx.error
  const { user, adminClient } = ctx
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await adminClient
    .from('loan_detail_views')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
