import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { invalidateAppSettingsCache } from '@/lib/app-settings'

async function verifySuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!me || !me.is_super) return null
  return { user, me }
}

export async function POST() {
  const block = await assertNotImpersonating()
  if (block) return block
  const auth = await verifySuperAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  // Increment the session_epoch atomically. We read-modify-write because Supabase JS
  // doesn't expose `set x = x + 1` directly; the row is single-row so contention is
  // negligible (super-admin only).
  const { data: current, error: readErr } = await admin
    .from('app_settings').select('session_epoch').eq('id', 1).single()
  if (readErr || !current) {
    return NextResponse.json({ error: readErr?.message ?? 'app_settings row missing' }, { status: 500 })
  }
  const nextEpoch = Number(current.session_epoch) + 1
  const { error: writeErr } = await admin
    .from('app_settings')
    .update({ session_epoch: nextEpoch, updated_at: new Date().toISOString(), updated_by: auth.user.id })
    .eq('id', 1)
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

  invalidateAppSettingsCache()

  // Sign the caller out so they have to re-authenticate too.
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

  return NextResponse.json({ success: true, session_epoch: nextEpoch })
}
