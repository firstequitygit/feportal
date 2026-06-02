// Daily cron — emails LO + LP(s) when:
//   - rate_lock_expiration_date is 5 days away or today
//   - appraisal_effective_date + 120 days is 5 days away or today
//   - credit_report_date + 90 days is 5 days away or today
//
// Dedup: every send writes an 'expiration_notified' row to loan_events
// keyed by `kind|warning|date`. Before sending we check for an existing
// row with the same key — if it's there, skip. This means re-running
// the cron the same day is safe, and a one-off expiration won't trigger
// a second email even if the cron schedule shifts.
//
// Recipients: each loan's LO + both LP slots. Borrower is intentionally
// not notified — these are operational dates, not borrower-facing.
//
// Protected by CRON_SECRET like the rest of the crons.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendExpirationWarningEmail, type ExpirationKind } from '@/lib/expiration-emails'

// FE policy: validity windows for the two date-based expirations. Rate
// lock has its own explicit expiration column on the loan row.
const APPRAISAL_VALID_DAYS = 120
const CREDIT_VALID_DAYS = 90

const WARNING_DAYS = [5, 0]  // 5 days out, then day-of

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  // Active loans only — closed/cancelled/archived loans aren't watched.
  // pipeline_stage is excluded for 'Closed' since those are no longer in
  // the active book even if not archived yet.
  const { data: loans } = await adminClient
    .from('loans')
    .select(`
      id, pipeline_stage, loan_status, archived,
      rate_lock_expiration_date,
      loan_details(appraisal_effective_date, credit_report_date)
    `)
    .eq('archived', false)
    .neq('pipeline_stage', 'Closed')

  if (!loans || loans.length === 0) {
    return NextResponse.json({ success: true, scanned: 0, sent: 0 })
  }

  // Compute today + 5-days-from-now in the same calendar timezone the
  // dates are stored in. Dates in the portal are stored as YYYY-MM-DD
  // strings (no timezone), so compare in UTC for stability.
  const today = isoDateOnlyUTC(new Date())
  const inFive = isoDateOnlyUTC(addDays(new Date(), 5))

  let sent = 0
  let skippedAlreadyNotified = 0

  for (const loan of loans) {
    // Skip on-hold / cancelled loans — same rule as other notifications.
    const status = (loan as { loan_status?: string | null }).loan_status
    if (status === 'on_hold' || status === 'cancelled') continue

    // Build the list of (kind, expirationDate) pairs to check for this loan.
    const details = (loan as { loan_details?: { appraisal_effective_date?: string | null; credit_report_date?: string | null } | { appraisal_effective_date?: string | null; credit_report_date?: string | null }[] | null }).loan_details
    const detail = Array.isArray(details) ? details[0] : details
    const checks: Array<{ kind: ExpirationKind; expirationDate: string | null }> = [
      { kind: 'rate_lock', expirationDate: (loan as { rate_lock_expiration_date?: string | null }).rate_lock_expiration_date ?? null },
      { kind: 'appraisal', expirationDate: detail?.appraisal_effective_date ? addDaysIso(detail.appraisal_effective_date, APPRAISAL_VALID_DAYS) : null },
      { kind: 'credit',    expirationDate: detail?.credit_report_date ? addDaysIso(detail.credit_report_date, CREDIT_VALID_DAYS) : null },
    ]

    for (const { kind, expirationDate } of checks) {
      if (!expirationDate) continue
      // Compare YYYY-MM-DD slices — the dates in the DB don't carry a
      // timestamp so a string compare against today / inFive is correct.
      const expDate = expirationDate.slice(0, 10)
      let daysUntil: number | null = null
      if (expDate === today) daysUntil = 0
      else if (expDate === inFive) daysUntil = 5
      if (daysUntil === null) continue

      // Dedup: skip if we already sent this exact notification.
      const dedupKey = `${kind}|${daysUntil === 0 ? 'dayof' : '5day'}|${expDate}`
      const { data: existing } = await adminClient
        .from('loan_events')
        .select('id')
        .eq('loan_id', loan.id)
        .eq('event_type', 'expiration_notified')
        .ilike('description', `%[${dedupKey}]%`)
        .maybeSingle()
      if (existing) { skippedAlreadyNotified++; continue }

      await sendExpirationWarningEmail(loan.id, kind, daysUntil, expirationDate)
      sent++

      // Write the audit/dedup row. The bracketed key in the description
      // is what the next run searches for; the rest is human-readable.
      try {
        await adminClient.from('loan_events').insert({
          loan_id: loan.id,
          event_type: 'expiration_notified',
          description: `[${dedupKey}] ${kindLabel(kind)} ${daysUntil === 0 ? 'expires today' : `expires in ${daysUntil} days`} (${expDate}) — emailed LO + LPs`,
        })
      } catch (err) {
        console.error('expiration_notified event log failed:', err)
      }
    }
  }

  return NextResponse.json({
    success: true,
    scanned: loans.length,
    sent,
    skippedAlreadyNotified,
    runAt: new Date().toISOString(),
  })
}

function isoDateOnlyUTC(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}
function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function kindLabel(k: ExpirationKind): string {
  switch (k) {
    case 'rate_lock': return 'Rate lock'
    case 'appraisal': return 'Appraisal'
    case 'credit':    return 'Credit report'
  }
}
