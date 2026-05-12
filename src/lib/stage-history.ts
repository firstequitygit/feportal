import { createAdminClient } from './supabase/admin'

/**
 * Record a stage transition for reporting.
 *
 * Closes any currently open row for this loan (sets exited_at to now)
 * and inserts a new row for the new stage. If the latest open row is
 * already on the same stage, it's left alone (no spurious transitions).
 *
 * Reports compute duration on read:
 *   COALESCE(exited_at, now()) - entered_at
 */
export async function recordStageChange(loanId: string, newStage: string): Promise<void> {
  const adminClient = createAdminClient()
  const now = new Date().toISOString()

  // Find the latest open row for this loan
  const { data: open } = await adminClient
    .from('loan_stage_history')
    .select('id, stage')
    .eq('loan_id', loanId)
    .is('exited_at', null)
    .order('entered_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // No-op if we're already tracking this stage
  if (open && open.stage === newStage) return

  // Close the previous open row
  if (open) {
    const { error } = await adminClient
      .from('loan_stage_history')
      .update({ exited_at: now })
      .eq('id', open.id)
    if (error) console.error('Failed to close previous stage history row:', error.message)
  }

  // Open the new row
  const { error: insertErr } = await adminClient
    .from('loan_stage_history')
    .insert({ loan_id: loanId, stage: newStage, entered_at: now })
  if (insertErr) console.error('Failed to insert new stage history row:', insertErr.message)
}
