'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeViewModeCookie } from '@/lib/view-mode-cookie'
import { getStaffUserOrNull } from '@/lib/staff-context'
import type { ViewMode } from '@/lib/types'

const BASE_ROLE_HOME: Record<string, string> = {
  loan_officer: '/loan-officer/loans',
  loan_processor: '/loan-processor/loans',
  underwriter: '/underwriter',
}

export async function setViewMode(mode: ViewMode): Promise<void> {
  const staff = await getStaffUserOrNull()
  if (!staff) redirect('/login')

  // Server-authoritative permission gate: only admins may set 'admin'.
  if (mode === 'admin' && !staff.is_admin) redirect('/login')

  // Only allow 'base' if there's actually a base role to go to.
  if (mode === 'base' && !staff.base_role && !staff.is_admin) redirect('/login')

  await writeViewModeCookie(mode)

  const admin = createAdminClient()
  await admin
    .from('staff_users')
    .update({ last_view_mode: mode })
    .eq('id', staff.id)

  const destination =
    mode === 'admin' ? '/admin' : (staff.base_role ? BASE_ROLE_HOME[staff.base_role] : '/admin')

  redirect(destination)
}
