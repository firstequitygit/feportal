import { NextResponse } from 'next/server'
import { z } from 'zod'
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

const PatchSchema = z.object({
  idle_timeout_hours: z.number().min(0.5).max(24).multipleOf(0.5).optional(),
  absolute_session_hours: z.number().int().min(1).max(168).optional(),
  maintenance_banner_enabled: z.boolean().optional(),
  maintenance_banner_message: z.string().max(500).optional(),
}).strict()

export async function PATCH(request: Request) {
  const block = await assertNotImpersonating()
  if (block) return block
  const auth = await verifySuperAdmin()
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  // Cross-field rule: if the banner is enabled, the message must be non-empty.
  if (parsed.data.maintenance_banner_enabled === true && parsed.data.maintenance_banner_message === '') {
    return NextResponse.json({ error: 'Maintenance message is required when the banner is enabled' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('app_settings')
    .update({ ...parsed.data, updated_at: new Date().toISOString(), updated_by: auth.user.id })
    .eq('id', 1)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateAppSettingsCache()
  return NextResponse.json({ success: true, settings: data })
}
