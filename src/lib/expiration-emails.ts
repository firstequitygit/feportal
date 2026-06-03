// Expiration / rate-lock notification emails to LO + LP(s).
//
// Three triggers handled here:
//   1. sendRateLockedEmail(loanId, daysLocked) — fired instantly when
//      rate_locked_days flips from "No" to 15/30/45 days. Tells LO + LPs
//      the rate is locked and for how many days.
//   2. sendExpirationWarningEmail(loanId, kind, daysUntil) — fired by
//      the daily cron at 5 days before expiry and on the day of.
//
// All failures are logged but never thrown — caller has already done
// its real work; email is a side effect.

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/mailer'
import { PORTAL_URL } from '@/lib/portal-url'
import { loanContextBlockHtml } from '@/lib/email-loan-context'

export type ExpirationKind = 'rate_lock' | 'appraisal' | 'credit' | 'maturity'

interface LoanRow {
  id: string
  property_address: string | null
  borrowers?: { full_name: string | null } | null
  loan_officers?: { full_name: string | null; email: string | null } | null
  loan_processors?: { full_name: string | null; email: string | null } | null
  loan_processor_2?: { full_name: string | null; email: string | null } | null
}

const STAFF_SELECT = `
  id, property_address,
  borrowers!borrower_id(full_name),
  loan_officers!loan_officer_id(full_name, email),
  loan_processors!loan_processor_id(full_name, email),
  loan_processor_2:loan_processors!loan_processor_id_2(full_name, email)
`

function staffRecipients(
  loan: LoanRow,
  scope: 'lo_only' | 'lo_plus_lps',
): Array<{ name: string | null; email: string }> {
  const out: Array<{ name: string | null; email: string }> = []
  const seen = new Set<string>()
  function push(p: { full_name: string | null; email: string | null } | null | undefined) {
    if (!p?.email) return
    const k = p.email.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push({ name: p.full_name, email: p.email })
  }
  push(loan.loan_officers)
  if (scope === 'lo_plus_lps') {
    push(loan.loan_processors)
    push(loan.loan_processor_2)
  }
  return out
}

const KIND_LABEL: Record<ExpirationKind, string> = {
  rate_lock: 'Rate lock',
  appraisal: 'Appraisal',
  credit:    'Credit report',
  maturity:  'Loan maturity',
}

// Per FE policy:
//   rate_lock / appraisal / credit → LO + both LP slots
//   maturity                       → LO only (operational ownership)
function recipientScope(kind: ExpirationKind): 'lo_only' | 'lo_plus_lps' {
  return kind === 'maturity' ? 'lo_only' : 'lo_plus_lps'
}

/**
 * Sends a "rate locked" email when rate_locked_days transitions from
 * "No" (or null) to a numeric option. days is the chosen lock window
 * (15 / 30 / 45) — used in the email copy.
 */
export async function sendRateLockedEmail(loanId: string, days: number): Promise<void> {
  try {
    const adminClient = createAdminClient()
    const { data: loanRaw } = await adminClient
      .from('loans')
      .select(STAFF_SELECT + ', rate_lock_expiration_date')
      .eq('id', loanId)
      .single()
    const loan = loanRaw as unknown as LoanRow & { rate_lock_expiration_date: string | null } | null
    if (!loan) return

    const recipients = staffRecipients(loan, 'lo_plus_lps')
    if (recipients.length === 0) return

    const property = loan.property_address ?? 'a loan'
    const contextBlock = loanContextBlockHtml({
      borrowerName: loan.borrowers?.full_name ?? null,
      loanOfficerName: loan.loan_officers?.full_name ?? null,
    })
    const expiresFormatted = formatDateForEmail(loan.rate_lock_expiration_date)
    const subject = `Rate locked for ${days} days — ${property}`

    const bodyHtml = (name: string | null) => `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${name ?? 'there'},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        The rate on <strong>${property}</strong> has been <strong style="color: #1F5D8F;">locked for ${days} days</strong>${expiresFormatted ? `, expiring on <strong>${expiresFormatted}</strong>` : ''}.
      </p>
      ${contextBlock}
      <p style="margin-top: 16px;">
        <a href="${PORTAL_URL}/loan-officer/loans/${loan.id}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">Open Loan</a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
    `

    await Promise.all(recipients.map(r =>
      sendEmail({ to: r.email, subject, html: bodyHtml(r.name) })
        .catch(err => console.error(`Rate-locked email to ${r.email} failed:`, err))
    ))
  } catch (err) {
    console.error('sendRateLockedEmail failed:', err)
  }
}

/**
 * Sends the "X expiring soon" / "X expired today" warning to LO + LPs.
 * daysUntil = 0 means the expiration date is today; positive numbers
 * mean N days away.
 */
export async function sendExpirationWarningEmail(
  loanId: string,
  kind: ExpirationKind,
  daysUntil: number,
  expirationDate: string,
): Promise<void> {
  try {
    const adminClient = createAdminClient()
    const { data: loanRaw } = await adminClient
      .from('loans')
      .select(STAFF_SELECT)
      .eq('id', loanId)
      .single()
    const loan = loanRaw as unknown as LoanRow | null
    if (!loan) return

    const recipients = staffRecipients(loan, recipientScope(kind))
    if (recipients.length === 0) return

    const property = loan.property_address ?? 'a loan'
    const kindLabel = KIND_LABEL[kind]
    const expiresFormatted = formatDateForEmail(expirationDate) ?? expirationDate
    const contextBlock = loanContextBlockHtml({
      borrowerName: loan.borrowers?.full_name ?? null,
      loanOfficerName: loan.loan_officers?.full_name ?? null,
    })

    // Maturity reads slightly differently ("Loan matures" vs "X expires")
    // so the recipient isn't decoding "Loan maturity expires today" copy.
    const isMaturity = kind === 'maturity'
    const verb = isMaturity ? 'matures' : 'expires'
    const subjectKindLabel = isMaturity ? 'Loan' : kindLabel
    const subject = daysUntil === 0
      ? `${subjectKindLabel} ${verb === 'matures' ? 'matures' : 'expires'} TODAY — ${property}`
      : `${subjectKindLabel} ${verb === 'matures' ? 'matures' : 'expires'} in ${daysUntil} days — ${property}`

    const phrase = isMaturity ? 'loan' : kindLabel.toLowerCase()
    const leadParagraph = daysUntil === 0
      ? `The <strong>${phrase}</strong> on <strong>${property}</strong> ${verb} <strong style="color: #b91c1c;">today</strong> (${expiresFormatted}).`
      : `The <strong>${phrase}</strong> on <strong>${property}</strong> ${verb} in <strong style="color: #d97706;">${daysUntil} days</strong> (${expiresFormatted}).`

    const bodyHtml = (name: string | null) => `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${name ?? 'there'},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">${leadParagraph}</p>
      ${contextBlock}
      <p style="margin-top: 16px;">
        <a href="${PORTAL_URL}/loan-officer/loans/${loan.id}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">Open Loan</a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
    `

    await Promise.all(recipients.map(r =>
      sendEmail({ to: r.email, subject, html: bodyHtml(r.name) })
        .catch(err => console.error(`Expiration email to ${r.email} failed:`, err))
    ))
  } catch (err) {
    console.error('sendExpirationWarningEmail failed:', err)
  }
}

/** "Jun 12, 2026" from an ISO date / timestamp string. */
function formatDateForEmail(val: string | null | undefined): string | null {
  if (!val) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(val)
  if (!m) return null
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}
