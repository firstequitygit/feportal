// Centralized "set this condition to Received" helper.
//
// Multiple code paths flip a condition into Received (text response,
// document upload, one-click email action, admin status PATCH). All of
// them need to:
//   1. Read the previous status so we know whether this is a transition
//      vs. a no-op write.
//   2. Update the row.
//   3. Fire the urgent-received notification (only when urgent +
//      transition INTO Received).
//
// Bundling steps 1-3 here means a new "set to Received" code path can't
// accidentally skip the notification.

import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyUwIfUrgentReceived } from '@/lib/notify-urgent-received'

interface Params {
  /** Service-role client. */
  adminClient: SupabaseClient
  conditionId: string
  /**
   * Extra columns to set in the same UPDATE — e.g. response text from
   * the borrower's reply. status='Received' is set unconditionally.
   */
  extra?: Record<string, unknown>
}

/**
 * Flips a condition to Received. Returns the Postgres error (or null on
 * success) so callers can propagate it the way they did before.
 */
export async function setConditionReceived({
  adminClient,
  conditionId,
  extra = {},
}: Params): Promise<{ error: { message: string } | null }> {
  const { data: prev } = await adminClient
    .from('conditions')
    .select('status')
    .eq('id', conditionId)
    .single()
  const previousStatus = (prev?.status as string | null) ?? null

  const { error } = await adminClient
    .from('conditions')
    .update({ status: 'Received', ...extra })
    .eq('id', conditionId)

  if (error) return { error: { message: error.message } }

  // Side effect — fire-and-forget. Helper itself swallows errors so a
  // mail failure can't roll back the status change.
  await notifyUwIfUrgentReceived({
    adminClient,
    conditionId,
    newStatus: 'Received',
    previousStatus,
  })

  return { error: null }
}
