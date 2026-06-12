// Returns the most recent staff note per bucket (Processor /
// Underwriter / Closer) for each loan, keyed by loan_id. Used by the
// role loans pages to surface the latest comments inline on each loan
// card. Loan Officer notes are deliberately excluded — the cards show
// the handoff chain (LP → UW → Closer), not the LO's own notes.
//
// The notes table has one row per note, so we pick the most recent per
// loan+bucket in JS — one SELECT ordered desc, first occurrence wins.

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient

export interface LatestStaffNotes {
  processor?: string
  underwriter?: string
  closer?: string
}

const CARD_NOTE_CATEGORIES = ['processor', 'underwriter', 'closer'] as const
type CardNoteCategory = (typeof CARD_NOTE_CATEGORIES)[number]

export async function fetchLatestStaffNotesByLoan(
  adminClient: AdminClient,
  loanIds: string[],
): Promise<Record<string, LatestStaffNotes>> {
  if (loanIds.length === 0) return {}
  const { data } = await adminClient
    .from('loan_notes')
    .select('loan_id, category, content')
    .in('loan_id', loanIds)
    .in('category', [...CARD_NOTE_CATEGORIES])
    .order('created_at', { ascending: false })

  const out: Record<string, LatestStaffNotes> = {}
  for (const r of data ?? []) {
    const id = r.loan_id as string
    const cat = r.category as CardNoteCategory
    const entry = (out[id] ??= {})
    if (entry[cat]) continue // already captured the most recent for this bucket
    entry[cat] = r.content as string
  }
  return out
}
