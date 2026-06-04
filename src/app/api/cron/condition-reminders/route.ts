// Daily cron — auto-nudges every active loan that's had outstanding
// borrower-assigned conditions for 3+ days since the last reminder.
//
// Recipient rule (delegated to sendConditionReminderEmail):
//   - If any broker slot is filled, ONLY brokers get the email —
//     borrower stays silent. This matches the existing rule across
//     all outbound mail (getLoanContacts uses the same gate).
//   - Otherwise, the active borrower slot(s) get it.
//
// Cadence:
//   - Weekdays only (skips Sat + Sun in UTC).
//   - Active loans only — skips on_hold / cancelled / archived /
//     Closed.
//   - Per loan, we check the timestamp for whichever party is the
//     actual recipient for that loan today. So a brokered loan
//     uses last_broker_reminder_at; an un-brokered loan uses
//     last_borrower_reminder_at. The other column is irrelevant
//     until the broker assignment changes.
//   - Fires only if (a) there's at least one outstanding/rejected
//     borrower-assigned condition and (b) the relevant timestamp
//     is NULL or > 3 days ago.
//
// Manual sends from /api/loans/conditions/reminder also stamp the
// matching timestamp, so a manual nudge resets the 3-day clock.
//
// Protected by CRON_SECRET. Idempotent — safe to re-run the same
// day; the timestamp gate handles dedup.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendConditionReminderEmail } from '@/lib/condition-reminder-email'

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Weekday gate (UTC). Sat = 6, Sun = 0. We don't want auto-reminders
  // landing in inboxes over the weekend.
  const now = new Date()
  const dow = now.getUTCDay()
  if (dow === 0 || dow === 6) {
    return NextResponse.json({ success: true, skipped: 'weekend', dayOfWeek: dow })
  }

  const adminClient = createAdminClient()

  const { data: loans } = await adminClient
    .from('loans')
    .select(`
      id, pipeline_stage, loan_status, archived,
      last_borrower_reminder_at, last_broker_reminder_at,
      borrower_id, borrower_id_2, borrower_id_3, borrower_id_4,
      broker_id, broker_id_2
    `)
    .eq('archived', false)
    .neq('pipeline_stage', 'Closed')

  if (!loans || loans.length === 0) {
    return NextResponse.json({ success: true, scanned: 0, sent: 0 })
  }

  let sent = 0
  let skippedNotDue = 0
  let skippedNoOutstanding = 0
  let skippedNoRecipients = 0

  const nowMs = now.getTime()

  for (const loan of loans) {
    const status = (loan as { loan_status?: string | null }).loan_status
    if (status === 'on_hold' || status === 'cancelled') continue

    // Cheap pre-check: any outstanding/rejected borrower-assigned
    // conditions at all? If not, skip without doing the send. The
    // helper would also return no_outstanding, but this saves the
    // join-heavy loan fetch inside the helper.
    const { count: outstandingCount } = await adminClient
      .from('conditions')
      .select('id', { count: 'exact', head: true })
      .eq('loan_id', loan.id)
      .eq('assigned_to', 'borrower')
      .in('status', ['Outstanding', 'Rejected'])
    if (!outstandingCount || outstandingCount === 0) {
      skippedNoOutstanding++
      continue
    }

    // Who would be the recipient today? Same rule as the helper —
    // we peek at it here so we know which timestamp column gates
    // the 3-day window. Even if the helper's choice doesn't match
    // (e.g. broker on file but no email), we handle that as a no-op
    // when the result comes back.
    const hasBroker = !!(loan.broker_id || loan.broker_id_2)
    const targetTimestamp = hasBroker ? loan.last_broker_reminder_at : loan.last_borrower_reminder_at
    const lastSent = targetTimestamp ? Date.parse(targetTimestamp) : 0
    if (lastSent && nowMs - lastSent < THREE_DAYS_MS) {
      skippedNotDue++
      continue
    }

    const result = await sendConditionReminderEmail(loan.id)
    if (result.sent === 0 || !result.party) {
      if (result.skippedReason === 'no_recipients') skippedNoRecipients++
      else if (result.skippedReason === 'no_outstanding') skippedNoOutstanding++
      continue
    }

    sent++
    const column = result.party === 'borrower' ? 'last_borrower_reminder_at' : 'last_broker_reminder_at'
    await adminClient
      .from('loans')
      .update({ [column]: new Date().toISOString() })
      .eq('id', loan.id)
    try {
      await adminClient.from('loan_events').insert({
        loan_id: loan.id,
        event_type: 'condition_reminder_sent',
        description: `Auto-reminder sent to ${result.party} (${result.sent} recipient${result.sent !== 1 ? 's' : ''}, ${result.conditionsCount} outstanding item${result.conditionsCount !== 1 ? 's' : ''})`,
      })
    } catch (err) {
      console.error('auto reminder event log error:', err)
    }
  }

  return NextResponse.json({
    success: true,
    scanned: loans.length,
    sent,
    skippedNotDue,
    skippedNoOutstanding,
    skippedNoRecipients,
    runAt: now.toISOString(),
  })
}
