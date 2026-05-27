import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSetting, setPortalSetting } from '@/lib/portal-settings'

const ALLOWED_KEYS = ['applications_processing_inbox'] as const
type AllowedKey = (typeof ALLOWED_KEYS)[number]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isAllowedKey(k: string): k is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(k)
}

type AdminGateResult =
  | { error: NextResponse }
  | { user: { id: string }; admin: { id: string; full_name: string | null } }

async function requireAdmin(): Promise<AdminGateResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }

  const { data: admin } = await supabase
    .from('admin_users')
    .select('id, full_name')
    .eq('auth_user_id', user.id)
    .single()
  if (!admin) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }

  return { user: { id: user.id }, admin }
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const key = req.nextUrl.searchParams.get('key')
  if (!key || !isAllowedKey(key)) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 })
  }

  const value = await getPortalSetting(key)

  const supabase = createAdminClient()
  const { data: row } = await supabase
    .from('portal_settings')
    .select('updated_at, updated_by')
    .eq('key', key)
    .maybeSingle()

  let updatedByName: string | null = null
  if (row?.updated_by) {
    const { data: editor } = await supabase
      .from('admin_users')
      .select('full_name')
      .eq('auth_user_id', row.updated_by)
      .maybeSingle()
    updatedByName = editor?.full_name ?? null
  }

  return NextResponse.json({
    value: value ?? '',
    updated_at: row?.updated_at ?? null,
    updated_by_name: updatedByName,
  })
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  let body: { key?: unknown; value?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const { key, value } = body
  if (typeof key !== 'string' || !isAllowedKey(key)) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 })
  }
  if (typeof value !== 'string') {
    return NextResponse.json({ error: 'value must be a string' }, { status: 400 })
  }

  const trimmed = value.trim()
  if (trimmed.length > 0) {
    if (!EMAIL_RE.test(trimmed) || trimmed.includes(',')) {
      return NextResponse.json(
        { error: 'value must be empty or a single well-formed email address' },
        { status: 400 },
      )
    }
  }

  try {
    await setPortalSetting(key, trimmed, gate.user.id)
  } catch (err) {
    console.error('PUT /api/admin/settings setPortalSetting failed:', err)
    return NextResponse.json({ error: 'failed to save setting' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
