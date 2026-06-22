// Per-user manual loan-card ordering for the LO/LP/UW Loans list.
//
// Each row is one card a staff member has dragged into a specific slot
// within a stage. The render merges these "pins" over the default sort:
// pinned cards splice into their saved slot index; un-pinned cards keep
// flowing in the default (stalest-first) order around them. See the
// merge logic in loan-list-sorted.tsx.
//
// Returns null when the loan_card_order table doesn't exist yet (code
// deployed before the migration ran) — the caller treats null as
// "feature off", so no drag handles appear until the table is created.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CardOrderEntry {
  /** The stage the card was pinned within. If the loan later moves to a
   *  different stage, this no longer matches and the pin is ignored
   *  (the loan reverts to default order in its new stage). */
  stage: string
  /** Absolute slot index within the stage. */
  position: number
  /** Epoch ms — breaks ties when two pins land on the same slot
   *  (more recent drag wins). */
  updatedAt: number
}

export async function fetchCardOrder(
  adminClient: SupabaseClient,
  authUserId: string,
  loanIds: string[],
): Promise<Record<string, CardOrderEntry> | null> {
  if (loanIds.length === 0) return {}
  const { data, error } = await adminClient
    .from('loan_card_order')
    .select('loan_id, stage, position, updated_at')
    .eq('auth_user_id', authUserId)
    .in('loan_id', loanIds)

  if (error) return null // table missing (pre-migration) → feature off

  const out: Record<string, CardOrderEntry> = {}
  for (const r of data ?? []) {
    out[r.loan_id as string] = {
      stage: r.stage as string,
      position: Number(r.position),
      updatedAt: r.updated_at ? new Date(r.updated_at as string).getTime() : 0,
    }
  }
  return out
}
