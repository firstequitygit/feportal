// Daily cron — emails staff when a loan-level date is approaching:
//   - rate_lock_expiration_date          5 days away  / today      → LO + LP(s)
//   - appraisal_effective_date + 120d    5 days away  / today      → LO + LP(s)
//   - credit_report_date + 90d           5 days away  / today      → LO + LP(s)
//   - maturity_date                     45 / 15 / 5 / today        → LO only
//
// Dedup: every send writes an 'expiration_notified' row to loan_events
// keyed by `kind|window|date`. Before sending we check for an existing
// row with the same key — if it's there, skip. This means re-running
// the cron the same day is safe, and a one-off expiration won't trigger
// a second email even if the cron schedule shifts.
//
// Borrowers are intentionally not notified — these are operational
// dates, not borrower-facing.
//
// Protected by CRON_SECRET like the rest of the crons.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendExpirationWarningEmail, type ExpirationKind } from '@/lib/expiration-emails'

// FE policy: validity windows for the two date-based expirations. Rate
// lock + maturity have their own explicit expiration columns on the loan row.
const APPRAISAL_VALID_DAYS = 120
const CREDIT_VALID_DAYS = 90

// Per-kind warning windows (days before expiration to send). Maturity
// gets the longest ladder; appraisal + credit have a 15-day heads-up
// so staff can schedule a re-pull / re-appraisal in time; rate lock
// stays short because lock windows themselves are short (15-45 days).
const WINDOWS_BY_KIND: Record<ExpirationKind, number[]> = {
  rate_lock: [5, 0],
  appraisal: [15, 5, 0],
  credit:    [15, 5, 0],
  maturity:  [45, 15, 5, 0],
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  // Active loans only — closed/cancelled/archived loans aren't watched.
  // Maturity-date scans intentionally still include Closed loans here —
  // a loan can fund and then mature before the auto-archive cron sweeps
  // it. The per-loop status filter below skips archived/cancelled anyway.
  const { data: loans } = await adminClient
    .from('loans')
    .select(`
      id, pipeline_stage, loan_status, archived,
      rate_lock_expiration_date,
      maturity_date,
      loan_details(appraisal_effective_date, credit_report_date)
    `)
    .eq('archived', false)
    .neq('pipeline_stage', 'Closed')

  if (!loans || loans.length === 0) {
    return NextResponse.json({ success: true, scanned: 0, sent: 0 })
  }

  // Today in UTC — dates in the portal are stored as YYYY-MM-DD
  // strings (no timezone), so compare in UTC for stability.
  const today = isoDateOnlyUTC(new Date())

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
      { kind: 'maturity',  expirationDate: (loan as { maturity_date?: string | null }).maturity_date ?? null },
    ]

    for (const { kind, expirationDate } of checks) {
      if (!expirationDate) continue
      // Compute exact day delta. Dates in the DB are YYYY-MM-DD strings
      // (no timezone), so parse + diff in UTC for a stable answer.
      const expDate = expirationDate.slice(0, 10)
      const diffDays = daysBetween(today, expDate)
      // Maturity ladder is 45/15/5/0; everything else is 5/0. Only fire
      // when the diff matches one of the per-kind windows exactly.
      if (!WINDOWS_BY_KIND[kind].includes(diffDays)) continue
      const daysUntil = diffDays

      // Dedup: skip if we already sent this exact notification. Key
      // includes the actual days-until so a maturity-45 send and a
      // later maturity-15 send for the same loan don't collide.
      const windowKey = daysUntil === 0 ? 'dayof' : `${daysUntil}day`
      const dedupKey = `${kind}|${windowKey}|${expDate}`
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
      const verb = kind === 'maturity' ? 'matures' : 'expires'
      const recipientLabel = kind === 'maturity' ? 'LO' : 'LO + LPs'
      try {
        await adminClient.from('loan_events').insert({
          loan_id: loan.id,
          event_type: 'expiration_notified',
          description: `[${dedupKey}] ${kindLabel(kind)} ${daysUntil === 0 ? `${verb} today` : `${verb} in ${daysUntil} days`} (${expDate}) — emailed ${recipientLabel}`,
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
function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
/** Whole-day diff in UTC: positive = target is in the future. */
function daysBetween(today: string, target: string): number {
  const a = parseIsoUTC(today)
  const b = parseIsoUTC(target)
  if (a === null || b === null) return Number.NaN
  return Math.round((b - a) / 86_400_000)
}
function parseIsoUTC(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
function kindLabel(k: ExpirationKind): string {
  switch (k) {
    case 'rate_lock': return 'Rate lock'
    case 'appraisal': return 'Appraisal'
    case 'credit':    return 'Credit report'
    case 'maturity':  return 'Loan maturity'
  }
}
