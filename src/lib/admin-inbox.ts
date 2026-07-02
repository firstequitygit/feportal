// Identity + count helpers for the admin portal's personal Inbox.
//
// Some admins also hold an LO / LP / UW row under the same login
// (Alexis Vega: admin + a loan_processors "Operations" row; Anthony
// Palmiotto: admin + LO; etc). Conditions get pinned to those rows by
// name via conditions.assigned_to_staff_id (the "Other" picker on the
// condition-add forms), but the role inboxes only surface conditions
// on loans where the person holds a loan-level slot. The admin Inbox
// closes that gap: it is a personal queue of every condition pinned to
// any of the caller's staff identities, on an active loan.

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient

export interface AdminIdentities {
  admin: { id: string; full_name: string | null } | null
  loId: string | null
  lpId: string | null
  uwId: string | null
}

export async function resolveAdminIdentities(
  adminClient: AdminClient,
  authUserId: string,
): Promise<AdminIdentities> {
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }] = await Promise.all([
    adminClient.from('admin_users').select('id, full_name').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('loan_processors').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', authUserId).maybeSingle(),
  ])
  return {
    admin: admin ?? null,
    loId: lo?.id ?? null,
    lpId: lp?.id ?? null,
    uwId: uw?.id ?? null,
  }
}

/** The LO/LP/UW row ids a condition can be pinned to. */
export function staffRoleIds(ids: AdminIdentities): string[] {
  return [ids.loId, ids.lpId, ids.uwId].filter((v): v is string => !!v)
}

/** Every mention identity the caller owns (admin stream + role streams). */
export function mentionIdents(ids: AdminIdentities): Array<{
  kind: 'admin' | 'loan_officer' | 'loan_processor' | 'underwriter'
  id: string
}> {
  const idents: Array<{ kind: 'admin' | 'loan_officer' | 'loan_processor' | 'underwriter'; id: string }> = []
  if (ids.admin) idents.push({ kind: 'admin', id: ids.admin.id })
  if (ids.loId) idents.push({ kind: 'loan_officer', id: ids.loId })
  if (ids.lpId) idents.push({ kind: 'loan_processor', id: ids.lpId })
  if (ids.uwId) idents.push({ kind: 'underwriter', id: ids.uwId })
  return idents
}

/**
 * Sidebar-badge count: conditions pinned to the caller that still need
 * action, on active loans. Mirrors countOutstandingForRole's activity
 * rules (archived / Closed / on_hold loans don't ping the badge).
 */
export async function countPinnedOutstanding(
  adminClient: AdminClient,
  roleIds: string[],
): Promise<number> {
  if (roleIds.length === 0) return 0
  const { data: pinned } = await adminClient
    .from('conditions')
    .select('loan_id, status')
    .in('assigned_to_staff_id', roleIds)
    .in('status', ['Outstanding', 'Rejected'])
  if (!pinned || pinned.length === 0) return 0

  const loanIds = [...new Set(pinned.map(p => p.loan_id as string))]
  const { data: loans } = await adminClient
    .from('loans')
    .select('id, archived, pipeline_stage, loan_status')
    .in('id', loanIds)
  const active = new Set(
    (loans ?? [])
      .filter(l => !l.archived && l.pipeline_stage !== 'Closed' && l.loan_status !== 'on_hold')
      .map(l => l.id as string),
  )
  return pinned.filter(p => active.has(p.loan_id as string)).length
}
