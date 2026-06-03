// Returns the most recent Closer Notes entry per loan, as a map keyed
// by loan_id. Used by the role loans pages to surface the latest
// closer comment inline on each loan card.
//
// The notes table has one row per note, so we have to pick the most
// recent per loan. Doing it in JS keeps the query simple — one SELECT
// ordered desc, then take the first occurrence per loan.

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient

export async function fetchLatestCloserNotesByLoan(
  adminClient: AdminClient,
  loanIds: string[],
): Promise<Record<string, string>> {
  if (loanIds.length === 0) return {}
  const { data } = await adminClient
    .from('loan_notes')
    .select('loan_id, content')
    .in('loan_id', loanIds)
    .eq('category', 'closer')
    .order('created_at', { ascending: false })

  const out: Record<string, string> = {}
  for (const r of data ?? []) {
    const id = r.loan_id as string
    if (out[id]) continue  // already captured the most recent
    out[id] = r.content as string
  }
  return out
}
