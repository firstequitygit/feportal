// Lean count of "Outstanding for you" conditions used by the sidebar
// Inbox badge. Same definition as the dashboard tile of the same name,
// but optimized to just return a count (no buckets, no volume math).
//
// Logic mirrors /lib/dashboard-metrics.ts:
//   - Loans scoped to this user's assignment (LO/LP/UW)
//   - Active only: archived = false, pipeline_stage != Closed,
//                  loan_status != on_hold (held loans don't ping the badge)
//   - Conditions actionable for the role:
//       LO  → assigned_to=loan_officer   AND status in (Outstanding, Rejected)
//       LP  → assigned_to=loan_processor AND status in (Outstanding, Rejected)
//       UW  → assigned_to=underwriter    AND status in (Outstanding, Rejected)
//             OR status in (Received, Under Review)  ← UW reviews these
//                                                       regardless of assignee

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient
type Role = 'loan_officer' | 'loan_processor' | 'underwriter'

export async function countOutstandingForRole(
  adminClient: AdminClient,
  role: Role,
  roleId: string,
): Promise<number> {
  // 1. Find this user's active loans.
  let loansQuery = adminClient
    .from('loans')
    .select('id, loan_status')
    .eq('archived', false)
    .neq('pipeline_stage', 'Closed')

  if (role === 'loan_officer') {
    loansQuery = loansQuery.eq('loan_officer_id', roleId)
  } else if (role === 'loan_processor') {
    loansQuery = loansQuery.or(`loan_processor_id.eq.${roleId},loan_processor_id_2.eq.${roleId}`)
  } else {
    loansQuery = loansQuery.eq('underwriter_id', roleId)
  }

  const { data: loans } = await loansQuery
  // Skip on-hold loans — same rule used elsewhere for "your queue".
  const activeLoanIds = (loans ?? [])
    .filter((l: { loan_status?: string | null }) => l.loan_status !== 'on_hold')
    .map((l: { id: string }) => l.id)
  if (activeLoanIds.length === 0) return 0

  // 2. Pull actionable conditions across those loans.
  const { data: conditions } = await adminClient
    .from('conditions')
    .select('assigned_to, status')
    .in('loan_id', activeLoanIds)
    .or('status.eq.Outstanding,status.eq.Rejected,status.eq.Received,status.eq.Under Review')

  // 3. Count only the ones actionable for this user's role.
  let count = 0
  for (const c of conditions ?? []) {
    const yours =
      (c.assigned_to === role && (c.status === 'Outstanding' || c.status === 'Rejected')) ||
      (role === 'underwriter' && (c.status === 'Received' || c.status === 'Under Review'))
    if (yours) count++
  }
  return count
}
