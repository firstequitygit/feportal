// Builds the two activity maps the loan lists need from loan_events:
//   lastUpdatedMap   — loan_id → most recent event of ANY kind
//   roleActivityMap  — loan_id → most recent LP event / UW event
//                      (events tagged via the loan_events.actor_role
//                      column — see the actor-role migration + trigger)
//
// Deploy-order safe: if the actor_role column doesn't exist yet (code
// deployed before the migration ran), falls back to the legacy query
// and returns an empty roleActivityMap — cards just hide the stamps.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RoleActivity } from '@/components/loans/role-activity-stamp'

interface EventRow {
  loan_id: string
  created_at: string
  actor_role?: string | null
}

export interface LoanActivityMaps {
  lastUpdatedMap: Record<string, string>
  roleActivityMap: Record<string, RoleActivity>
}

export async function fetchLoanActivityMaps(
  adminClient: SupabaseClient,
  loanIds: string[],
): Promise<LoanActivityMaps> {
  const lastUpdatedMap: Record<string, string> = {}
  const roleActivityMap: Record<string, RoleActivity> = {}
  if (loanIds.length === 0) return { lastUpdatedMap, roleActivityMap }

  let rows: EventRow[] = []
  const { data, error } = await adminClient
    .from('loan_events')
    .select('loan_id, created_at, actor_role')
    .in('loan_id', loanIds)
    .order('created_at', { ascending: false })

  if (error) {
    // actor_role column missing (migration not run yet) — legacy query.
    const { data: legacy } = await adminClient
      .from('loan_events')
      .select('loan_id, created_at')
      .in('loan_id', loanIds)
      .order('created_at', { ascending: false })
    rows = (legacy ?? []) as EventRow[]
  } else {
    rows = (data ?? []) as EventRow[]
  }

  // Rows are newest-first, so the first hit per bucket wins.
  for (const e of rows) {
    if (!lastUpdatedMap[e.loan_id]) lastUpdatedMap[e.loan_id] = e.created_at

    if (e.actor_role === 'loan_processor' || e.actor_role === 'underwriter') {
      let entry = roleActivityMap[e.loan_id]
      if (!entry) {
        entry = { lp: null, uw: null }
        roleActivityMap[e.loan_id] = entry
      }
      if (e.actor_role === 'loan_processor' && !entry.lp) entry.lp = e.created_at
      if (e.actor_role === 'underwriter' && !entry.uw) entry.uw = e.created_at
    }
  }

  return { lastUpdatedMap, roleActivityMap }
}
