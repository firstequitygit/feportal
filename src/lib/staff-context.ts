import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { readViewModeCookie } from './view-mode-cookie'
import type { StaffContext, StaffUser } from './types'

// New auth seam for the staff identity refactor. Coexists with
// getEffectiveRoleRow (src/lib/impersonate.ts) during the transition;
// that function stays in charge of View-As impersonation. This one
// resolves "which role context is the visitor in right now" from the
// staff_users row + fe_view_mode cookie.
export async function getEffectiveStaffContext(): Promise<StaffContext | null> {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data } = await admin
    .from('staff_users')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  const row = (data ?? null) as StaffUser | null
  if (!row) return null

  const cookieMode = await readViewModeCookie()
  const can_toggle = row.is_admin && row.base_role !== null
  const wantsAdmin = (cookieMode ?? row.last_view_mode) === 'admin'

  let active_kind: StaffContext['active_kind'] | null = null
  if (row.is_admin && wantsAdmin) {
    active_kind = 'admin'
  } else if (row.base_role) {
    active_kind = row.base_role
  } else if (row.is_admin) {
    active_kind = 'admin'
  }

  if (!active_kind) return null
  return { staff_user: row, active_kind, can_toggle }
}

export async function getStaffUserOrNull(): Promise<StaffUser | null> {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('staff_users')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  return (data ?? null) as StaffUser | null
}
