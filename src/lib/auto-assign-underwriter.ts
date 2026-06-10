// Auto-assigns the default underwriter (Alicyn DeSimone) to a loan when it
// transitions into Pre-Underwriting. Loans without a prior UW arrive in
// Alicyn's queue directly.
//
// Deliberately silent: no email is sent on assignment. Alicyn asked for
// the Pre-Underwriting alert to be removed (June 2026) — her /underwriter
// queue and the sidebar Inbox badge are the signal instead.
//
// Skip conditions (no-op + return false):
//   - Loan already has underwriter_id set (don't clobber a manual pick)
//   - Default UW row not found (name typo / staff turnover)
//
// Called from /api/loans/stage, /api/sync, /api/webhooks/pipedrive. Cron
// sync does not call this (cron is the silent backfill path, matches the
// existing email-trigger policy).

import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

// Lookup by full_name — change here if the default UW changes. Could also
// graduate to an `is_default_underwriter` boolean on the underwriters
// table if multiple defaults or rotation logic is needed later.
const DEFAULT_UNDERWRITER_NAME = 'Alicyn DeSimone'

export async function autoAssignDefaultUnderwriter(
  adminClient: AdminClient,
  loanId: string,
): Promise<{ assigned: boolean; reason?: string }> {
  // Don't override an existing assignment.
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, underwriter_id')
    .eq('id', loanId)
    .single()
  if (!loan) return { assigned: false, reason: 'loan not found' }
  if (loan.underwriter_id) return { assigned: false, reason: 'already assigned' }

  const { data: uw } = await adminClient
    .from('underwriters')
    .select('id, full_name')
    .ilike('full_name', DEFAULT_UNDERWRITER_NAME)
    .maybeSingle()
  if (!uw) return { assigned: false, reason: 'default underwriter not found' }

  const { error } = await adminClient
    .from('loans').update({ underwriter_id: uw.id }).eq('id', loanId)
  if (error) {
    console.error('Auto-assign UW update failed:', error.message)
    return { assigned: false, reason: error.message }
  }

  // Audit log — same format as manual underwriter assignment events.
  try {
    await adminClient.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'underwriter_assigned',
      description: `${uw.full_name} auto-assigned as Underwriter on Pre-Underwriting transition`,
    })
  } catch (err) { console.error('Auto-assign UW event log error:', err) }

  return { assigned: true }
}
