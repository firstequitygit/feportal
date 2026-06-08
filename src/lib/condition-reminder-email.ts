// Outstanding-conditions reminder email — fires from both the manual
// "Send Reminder" button on the loan header and the daily auto-cron.
//
// Recipient rule (matches getLoanContacts):
//   - If any broker slot is filled, ONLY brokers get emails — primary
//     broker + co-broker / broker processor. Borrowers are silent on
//     brokered loans, even when they have outstanding items.
//   - Otherwise, every active borrower slot (email + auth_user_id)
//     gets the reminder.
//
// This rule lives inside this helper so it can't be bypassed by a
// stale UI control or a manual API call. Callers don't choose the
// party — the result tells them which party was actually emailed so
// they can update the right last_*_reminder_at timestamp.
//
// The body lists every condition assigned to 'borrower' whose status
// is Outstanding or Rejected (the standard "outstanding for display"
// rule from types.ts). Closer / staff conditions are intentionally
// excluded — those aren't borrower/broker-facing.

import { createAdminClient } from './supabase/admin'
import { getTransporter } from './email'
import { PORTAL_URL, PORTAL_DOMAIN } from './portal-url'
import { formatLoanName } from './format-loan-name'

export type ReminderParty = 'borrower' | 'broker'

export interface ReminderResult {
  /** Which party was actually emailed, or null if we skipped. */
  party: ReminderParty | null
  sent: number
  recipients: string[]
  conditionsCount: number
  skippedReason?: 'no_recipients' | 'no_outstanding' | 'loan_inactive'
}

interface OutstandingCondition {
  title: string
  description: string | null
  status: string
}

/**
 * Send the outstanding-conditions reminder for a single loan. The
 * helper decides whether the email goes to broker(s) or borrower(s)
 * based on whether a broker is on the loan — callers don't pick.
 *
 * Returns the chosen party so the caller can stamp the right
 * last_*_reminder_at column and write a focused audit row.
 *
 * Does NOT touch the loans table or write events itself — that's
 * the caller's job. Keeps the helper reusable from the manual
 * route and the cron without coupling them to each other.
 */
export async function sendConditionReminderEmail(loanId: string): Promise<ReminderResult> {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select(`
      id, property_address, loan_number, pipeline_stage, loan_status, archived,
      borrowers!borrower_id(full_name, email, auth_user_id),
      borrower_2:borrowers!borrower_id_2(full_name, email, auth_user_id),
      borrower_3:borrowers!borrower_id_3(full_name, email, auth_user_id),
      borrower_4:borrowers!borrower_id_4(full_name, email, auth_user_id),
      brokers!broker_id(full_name, email),
      broker_2:brokers!broker_id_2(full_name, email),
      loan_officers(full_name)
    `)
    .eq('id', loanId)
    .single()
  if (!loan) {
    return { party: null, sent: 0, recipients: [], conditionsCount: 0, skippedReason: 'no_recipients' }
  }

  // Active loans only — never nudge a closed / cancelled / on-hold /
  // archived loan, even via the manual button. The header button
  // should already be hidden in those states; defend in depth.
  const status = (loan as { loan_status?: string | null }).loan_status
  if (status === 'on_hold' || status === 'cancelled' || loan.archived || loan.pipeline_stage === 'Closed') {
    return { party: null, sent: 0, recipients: [], conditionsCount: 0, skippedReason: 'loan_inactive' }
  }

  // Outstanding-or-rejected conditions assigned to the borrower.
  // Rejected counts as outstanding for nudge purposes (matches
  // types.ts and the inbox badge).
  const { data: rawConditions } = await adminClient
    .from('conditions')
    .select('title, description, status, assigned_to')
    .eq('loan_id', loanId)
    .eq('assigned_to', 'borrower')
    .in('status', ['Outstanding', 'Rejected'])
    .order('created_at', { ascending: true })

  const conditions: OutstandingCondition[] = (rawConditions ?? []).map(c => ({
    title: c.title,
    description: c.description ?? null,
    status: c.status,
  }))
  if (conditions.length === 0) {
    return { party: null, sent: 0, recipients: [], conditionsCount: 0, skippedReason: 'no_outstanding' }
  }

  // Decide the party. Brokers win — if any broker slot is filled,
  // the borrower is silent. Mirrors getLoanContacts so all external
  // comms follow the same rule.
  const brokerSlots = [
    loan.brokers,
    (loan as unknown as { broker_2: { full_name: string | null; email: string | null } | null }).broker_2,
  ] as Array<{ full_name: string | null; email: string | null } | null>
  const hasBrokerSlot = brokerSlots.some(b => !!b)
  const party: ReminderParty = hasBrokerSlot ? 'broker' : 'borrower'

  // Resolve recipients for the chosen party.
  const seenEmail = new Set<string>()
  const recipients: { email: string; name: string | null }[] = []
  if (party === 'broker') {
    for (const b of brokerSlots) {
      if (!b?.email) continue
      const k = b.email.toLowerCase()
      if (seenEmail.has(k)) continue
      seenEmail.add(k)
      recipients.push({ email: b.email, name: b.full_name })
    }
  } else {
    const borrowerSlots = [
      loan.borrowers,
      (loan as unknown as { borrower_2: { full_name: string | null; email: string | null; auth_user_id: string | null } | null }).borrower_2,
      (loan as unknown as { borrower_3: { full_name: string | null; email: string | null; auth_user_id: string | null } | null }).borrower_3,
      (loan as unknown as { borrower_4: { full_name: string | null; email: string | null; auth_user_id: string | null } | null }).borrower_4,
    ] as Array<{ full_name: string | null; email: string | null; auth_user_id: string | null } | null>
    for (const b of borrowerSlots) {
      if (!b?.email) continue
      // Same gate as getLoanContacts — borrowers without an active
      // portal login don't get nudges, only the one-time invite.
      if (!b.auth_user_id) continue
      const k = b.email.toLowerCase()
      if (seenEmail.has(k)) continue
      seenEmail.add(k)
      recipients.push({ email: b.email, name: b.full_name })
    }
  }
  if (recipients.length === 0) {
    return { party, sent: 0, recipients: [], conditionsCount: conditions.length, skippedReason: 'no_recipients' }
  }

  const property = loan.property_address ?? 'your loan'
  const portalPath = party === 'broker' ? '/broker' : '/dashboard'
  const loanOfficerName =
    (loan.loan_officers as unknown as { full_name: string | null } | null)?.full_name ?? null

  // Primary borrower's name powers the standard "Borrower — Street"
  // label used in the subject line.
  const primaryBorrowerName = (loan.borrowers as unknown as { full_name: string | null } | null)?.full_name ?? null
  const loanName = formatLoanName({
    borrowerName: primaryBorrowerName,
    propertyAddress: loan.property_address,
    loanNumber: loan.loan_number,
  })

  const subject = conditions.length === 1
    ? `Reminder — outstanding item (${loanName})`
    : `Reminder — ${conditions.length} outstanding items (${loanName})`

  // Per-party intro copy. Broker version reframes the same list as
  // "items your borrower still owes" so the broker can chase them;
  // borrower version is direct.
  const introCopy = (greeting: string) => party === 'broker'
    ? `<p style="font-size: 15px; margin-top: 0;">Hi ${greeting},</p>
       <p style="font-size: 15px;">
         The loan for <strong>${property}</strong> still has
         ${conditions.length === 1 ? 'one outstanding item' : `${conditions.length} outstanding items`}
         that the borrower needs to submit before we can move forward.
         Please nudge your borrower at your convenience.
       </p>`
    : `<p style="font-size: 15px; margin-top: 0;">Hi ${greeting},</p>
       <p style="font-size: 15px;">
         This is a friendly reminder that your loan for <strong>${property}</strong>
         still has ${conditions.length === 1 ? 'one outstanding item' : `${conditions.length} outstanding items`}
         we need from you before we can move forward.
       </p>`

  const conditionRows = conditions.map(c => {
    const statusBadge = c.status === 'Rejected'
      // Rejected items have already been seen + bounced — flag them
      // distinctly so the reader knows this isn't a fresh ask.
      ? `<span style="display:inline-block;margin-left:8px;padding:1px 7px;font-size:11px;font-weight:600;border-radius:9999px;background:#fee2e2;color:#991b1b;">Rejected — resubmit</span>`
      : ''
    const desc = c.description
      ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(c.description)}</div>`
      : ''
    return `
      <li style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
        <div style="font-size:14px;font-weight:600;color:#111827;">
          ${escapeHtml(c.title)}${statusBadge}
        </div>
        ${desc}
      </li>`
  }).join('')

  const loSig = loanOfficerName
    ? `<p style="font-size: 13px; color: #555; margin-top: 24px;">— ${escapeHtml(loanOfficerName)}<br/>First Equity Funding</p>`
    : `<p style="font-size: 13px; color: #555; margin-top: 24px;">— The First Equity Funding Team</p>`

  const bodyHtml = (greeting: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
      <div style="background-color: #1F5D8F; padding: 20px 28px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; color: white; font-size: 18px;">Outstanding items reminder</h1>
      </div>
      <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        ${introCopy(greeting)}
        <ul style="list-style:none;padding:0;margin:16px 0 0 0;border-top:1px solid #f3f4f6;">
          ${conditionRows}
        </ul>
        <p style="margin-top: 24px;">
          <a href="${PORTAL_URL}${portalPath}"
             style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">
            ${party === 'broker' ? 'Open Portal' : 'View My Loan'}
          </a>
        </p>
        ${loSig}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
        <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
      </div>
    </div>
  `

  const transporter = getTransporter()
  await Promise.all(recipients.map(r => {
    const first = r.name ? r.name.split(/\s+/)[0] : 'there'
    return transporter.sendMail({
      to: r.email,
      subject,
      html: bodyHtml(first),
    }).catch(err => console.error(`Reminder email to ${r.email} failed:`, err))
  }))

  return {
    party,
    sent: recipients.length,
    recipients: recipients.map(r => r.email),
    conditionsCount: conditions.length,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
