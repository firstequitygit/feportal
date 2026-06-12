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
  /**
   * When false, skips the urgent-received email to the UW even if the
   * condition is urgent and we just transitioned into Received.
   * Default: true (back-compat — every prior caller relied on this).
   *
   * Set to false from doc-upload + text-response paths where the
   * underwriter shouldn't get a per-document / per-response nudge.
   * Manual status changes by staff (admin/LO/LP/UW conditions routes)
   * still fire the email — they call notifyUwIfUrgentReceived
   * directly and aren't affected by this flag.
   */
  notifyUwOnUrgentReceived?: boolean
}

/**
 * Flips a condition to Received. Returns the Postgres error (or null on
 * success) so callers can propagate it the way they did before.
 */
export async function setConditionReceived({
  adminClient,
  conditionId,
  extra = {},
  notifyUwOnUrgentReceived = true,
}: Params): Promise<{ error: { message: string } | null }> {
  const { data: prev } = await adminClient
    .from('conditions')
    .select('status')
    .eq('id', conditionId)
    .single()
  const previousStatus = (prev?.status as string | null) ?? null

  // Text responses get a timestamp so the card can show when the
  // reply came in. Stamped here (the single chokepoint every
  // response-writing route funnels through) rather than per-route.
  const payload: Record<string, unknown> = { status: 'Received', ...extra }
  if ('response' in extra) payload.response_at = new Date().toISOString()

  let { error } = await adminClient
    .from('conditions')
    .update(payload)
    .eq('id', conditionId)

  // Deploy-order tolerance: if the response_at column doesn't exist yet
  // (migration not run), retry without it rather than failing the save.
  if (error && 'response_at' in payload && /response_at/.test(error.message)) {
    delete payload.response_at
    ;({ error } = await adminClient
      .from('conditions')
      .update(payload)
      .eq('id', conditionId))
  }

  if (error) return { error: { message: error.message } }

  // Side effect — fire-and-forget. Helper itself swallows errors so a
  // mail failure can't roll back the status change.
  //
  // Doc-upload + text-response callers pass false to suppress this —
  // those flows shouldn't nudge the UW per file / per response.
  if (notifyUwOnUrgentReceived) {
    await notifyUwIfUrgentReceived({
      adminClient,
      conditionId,
      newStatus: 'Received',
      previousStatus,
    })
  }

  return { error: null }
}
