// CRUD for the current staff user's saved Loan Details views.
//
//   GET    → list every view this user owns (newest first)
//   POST   → create a new view ({ name, hiddenFields, isDefault })
//
// Any authenticated staff role (admin / LO / LP / UW) can manage
// their own views — the auth_user_id check is the only access gate.
// Borrowers + brokers never see the Loan Details card so they're
// implicitly excluded; we still verify the user has at least one
// staff role to keep the API surface predictable.
//
// Body shapes match the loan_detail_views row directly. The "default"
// flag is enforced as at-most-one-per-user via a partial unique
// index on the table, so the route just clears any prior default
// before flipping a new one on.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { LOAN_DETAILS_FIELD_KEYS } from '@/lib/loan-details-fields'

/** Strip anything that isn't a known field key — defense against an
 *  older saved view referencing a key we since removed, or a hand-
 *  edited payload trying to write garbage to the jsonb column. */
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

export async function GET() {
  const ctx = await requireStaffUser()
  if ('error' in ctx) return ctx.error
  const { user, adminClient } = ctx

  const { data, error } = await adminClient
    .from('loan_detail_views')
    .select('id, name, hidden_fields, is_default, created_at, updated_at')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ views: data ?? [] })
}

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const ctx = await requireStaffUser()
  if ('error' in ctx) return ctx.error
  const { user, adminClient } = ctx

  const body = await req.json().catch(() => null) as
    | { name?: string; hiddenFields?: unknown; isDefault?: boolean }
    | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (name.length > 80) return NextResponse.json({ error: 'Name too long (max 80 chars)' }, { status: 400 })
  const hiddenFields = sanitizeHiddenFields(body?.hiddenFields)
  const isDefault = body?.isDefault === true

  if (isDefault) {
    // Clear the previous default so the partial unique index doesn't
    // reject the insert. Same pattern PATCH uses for the toggle.
    await adminClient.from('loan_detail_views')
      .update({ is_default: false })
      .eq('user_id', user.id)
      .eq('is_default', true)
  }

  const { data, error } = await adminClient
    .from('loan_detail_views')
    .insert({
      user_id: user.id,
      name,
      hidden_fields: hiddenFields,
      is_default: isDefault,
    })
    .select('id, name, hidden_fields, is_default, created_at, updated_at')
    .single()

  if (error) {
    // Unique-name collision → friendly 409 instead of the raw constraint msg.
    if (/unique/i.test(error.message)) {
      return NextResponse.json({ error: 'You already have a view with that name' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ view: data })
}
