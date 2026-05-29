// Fetch and group per-condition staff notes for a loan's conditions.
// Returns a map keyed by condition_id so the conditions component can
// look up a condition's notes in O(1) when rendering.

import type { createAdminClient } from '@/lib/supabase/admin'
import type { ConditionNote } from '@/components/condition-notes'

type AdminClient = ReturnType<typeof createAdminClient>

export async function fetchConditionNotesForLoan(
  adminClient: AdminClient,
  loanId: string,
): Promise<Record<string, ConditionNote[]>> {
  // The conditions on this loan, in case there are any. We use the joined
  // condition_id filter inside the conditions table so the policy of
  // "notes belong to the loan" is enforced by the join, not by separate
  // RLS / app rules.
  const { data: conds } = await adminClient
    .from('conditions').select('id').eq('loan_id', loanId)
  const ids = (conds ?? []).map(c => c.id)
  if (ids.length === 0) return {}

  const { data: rows } = await adminClient
    .from('condition_notes')
    .select('id, condition_id, content, created_by, created_at')
    .in('condition_id', ids)
    .order('created_at', { ascending: false })

  const out: Record<string, ConditionNote[]> = {}
  for (const r of (rows ?? []) as ConditionNote[]) {
    if (!out[r.condition_id]) out[r.condition_id] = []
    out[r.condition_id].push(r)
  }
  return out
}
