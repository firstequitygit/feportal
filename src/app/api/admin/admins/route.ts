import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomBytes } from 'node:crypto'

const ADJECTIVES = ['Brisk', 'Calm', 'Eager', 'Quiet', 'Sharp', 'Steady', 'Swift', 'Vivid']
const NOUNS      = ['Anchor', 'Beacon', 'Cedar', 'Drift', 'Ember', 'Falcon', 'Granite', 'Harbor']

function generateTempPassword(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}${noun}-${randomBytes(4).toString('hex')}`
}

async function verifySuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!me || !me.is_super) return null
  return { user, me }
}

// POST — create a new admin login. Returns the generated temp password
// so the caller can share it out-of-band.
export async function POST(request: Request) {
  if (!await verifySuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, full_name } = await request.json()
  if (!email?.trim() || !full_name?.trim()) {
    return NextResponse.json({ error: 'Email and full name are required' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Don't re-create if an admin row already exists
  const { data: existing } = await adminClient
    .from('admin_users').select('id').eq('email', email).maybeSingle()
  if (existing) {
    return NextResponse.json({ error: `Admin ${email} already exists` }, { status: 409 })
  }

  const tempPassword = generateTempPassword()

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name, role: 'admin' },
  })
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })

  const { data: row, error: rowErr } = await adminClient.from('admin_users').insert({
    auth_user_id: created.user.id,
    email,
    full_name,
    role: 'admin',
    is_super: false,
  }).select('id, full_name, email, is_super, created_at').single()
  if (rowErr) {
    // Roll back the auth user so we don't leak orphans
    await adminClient.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: rowErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, admin: row, tempPassword })
}

// DELETE — remove an admin. Super-admins can delete other admins; the
// component side blocks self-delete, but we double-check here.
export async function DELETE(request: Request) {
  const auth = await verifySuperAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (id === auth.me.id) return NextResponse.json({ error: "You can't delete yourself" }, { status: 400 })

  const adminClient = createAdminClient()
  const { data: target } = await adminClient
    .from('admin_users').select('auth_user_id, email').eq('id', id).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Admin not found' }, { status: 404 })

  const { error } = await adminClient.from('admin_users').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (target.auth_user_id) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(target.auth_user_id)
    if (authErr) console.error('Admin auth delete error:', authErr.message)
  }

  return NextResponse.json({ success: true })
}
