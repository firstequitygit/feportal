import nodemailer from 'nodemailer'
import { createAdminClient } from './supabase/admin'
import { PORTAL_URL, PORTAL_DOMAIN } from './portal-url'
import { getLoanContacts } from './loan-contact'

export function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

function shortStage(s: string | null): string {
  if (!s) return 'Unknown'
  return s.split(' /')[0].trim()
}

/**
 * Generic stage-change notification for any pipeline stage transition that
 * isn't covered by the specialized Loan Approved / Loan Funded emails.
 *
 * Recipients:
 *   - The loan's outside contacts via getLoanContacts() — broker if a broker
 *     is assigned, else every borrower slot. Each contact gets a personalized
 *     "Hi {name}" greeting.
 *   - Staff (LO + both LP slots) — get the same email with a generic greeting.
 */
export async function sendStageUpdateEmail(
  loanId: string,
  fromStage: string | null,
  toStage: string,
) {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select('property_address, loan_officers(email), loan_processors!loan_processor_id(email), loan_processor_2:loan_processors!loan_processor_id_2(email)')
    .eq('id', loanId)
    .single()
  if (!loan) return

  const lo = loan.loan_officers as unknown as { email: string | null } | null
  const lp  = loan.loan_processors as unknown as { email: string | null } | null
  const lp2 = (loan as unknown as { loan_processor_2: { email: string | null } | null }).loan_processor_2

  const contacts = await getLoanContacts(loanId)
  const staffEmails = [lo?.email, lp?.email, lp2?.email].filter((e): e is string => !!e)

  const recipients = buildRecipients(contacts, staffEmails)
  if (recipients.length === 0) return

  const property = loan.property_address ?? 'this property'
  const fromLabel = shortStage(fromStage)
  const toLabel = shortStage(toStage)

  const subject = `Loan stage updated — ${property}`
  const bodyHtml = (greeting: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
      <div style="background-color: #1F5D8F; padding: 20px 28px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; color: white; font-size: 18px;">Loan stage updated</h1>
      </div>
      <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 15px; margin-top: 0;">Hi ${greeting},</p>
        <p style="font-size: 15px;">
          The loan for <strong>${property}</strong> has moved to
          <strong style="color: #1F5D8F;">${toLabel}</strong>${fromStage ? ` (from ${fromLabel})` : ''}.
        </p>
        <p style="margin-top: 24px;">
          <a href="${PORTAL_URL}/dashboard"
             style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">
            View loan
          </a>
        </p>
        <p style="font-size: 13px; color: #555; margin-top: 24px;">— The First Equity Funding Team</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
        <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
      </div>
    </div>
  `

  const transporter = getTransporter()
  await Promise.all(recipients.map(r =>
    transporter.sendMail({
      from: `First Equity Funding <${process.env.GMAIL_USER}>`,
      to: r.email,
      subject,
      html: bodyHtml(r.greetingName),
    }).catch(err => console.error(`Stage update email to ${r.email} failed:`, err))
  ))
}

/**
 * Merge outside contacts (broker or borrowers) with staff emails into a
 * single, deduplicated recipient list. External contacts get a personalized
 * "Hi {first name}" greeting; staff get "there".
 */
function buildRecipients(
  contacts: Array<{ email: string; name: string | null }>,
  staffEmails: string[],
): Array<{ email: string; greetingName: string }> {
  const seen = new Set<string>()
  const out: Array<{ email: string; greetingName: string }> = []
  for (const c of contacts) {
    const k = c.email.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    const first = c.name ? c.name.split(/\s+/)[0] : null
    out.push({ email: c.email, greetingName: first ?? 'there' })
  }
  for (const e of staffEmails) {
    const k = e.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ email: e, greetingName: 'there' })
  }
  return out
}

export async function sendLoanFundedEmail(loanId: string) {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select('property_address, loan_officers(email), loan_processors!loan_processor_id(email), loan_processor_2:loan_processors!loan_processor_id_2(email)')
    .eq('id', loanId)
    .single()
  if (!loan) return

  const lo = loan.loan_officers as unknown as { email: string | null } | null
  const lp  = loan.loan_processors as unknown as { email: string | null } | null
  const lp2 = (loan as unknown as { loan_processor_2: { email: string | null } | null }).loan_processor_2

  const contacts = await getLoanContacts(loanId)
  const staffEmails = [lo?.email, lp?.email, lp2?.email].filter((e): e is string => !!e)
  const recipients = buildRecipients(contacts, staffEmails)
  if (recipients.length === 0) return

  const subject = `🏠 Loan funded — ${loan.property_address ?? 'property'}`
  const bodyHtml = (greeting: string) => `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
        <div style="background-color: #1F5D8F; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; color: white; font-size: 22px;">Loan Funded!</h1>
        </div>
        <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="font-size: 15px; margin-top: 0;">Hi ${greeting},</p>
          <p style="font-size: 15px;">
            Congratulations, your loan for <strong>${loan.property_address ?? 'your property'}</strong> has been
            <strong style="color: #1F5D8F;">successfully funded and closed!</strong>
          </p>
          <p style="font-size: 15px;">
            Thank you for trusting First Equity Funding to help make this happen. We truly appreciate your business
            and hope to work with you again in the future.
          </p>
          <p style="font-size: 15px;">
            You can log in to the portal at any time to review your loan details and documents.
          </p>
          <p style="margin-top: 28px;">
            <a href="${PORTAL_URL}"
               style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">
              View Loan
            </a>
          </p>
          <p style="font-size: 14px; color: #555; margin-top: 28px;">
            Congratulations and thank you for choosing First Equity Funding!<br/>
            <strong>The First Equity Funding Team</strong>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 28px;" />
          <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
        </div>
      </div>
    `

  const transporter = getTransporter()
  await Promise.all(recipients.map(r =>
    transporter.sendMail({
      from: `First Equity Funding <${process.env.GMAIL_USER}>`,
      to: r.email,
      subject,
      html: bodyHtml(r.greetingName),
    }).catch(err => console.error(`Loan Funded email to ${r.email} failed:`, err))
  ))
}

export async function sendLoanApprovedEmail(loanId: string) {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select('property_address, loan_officers(email), loan_processors!loan_processor_id(email), loan_processor_2:loan_processors!loan_processor_id_2(email)')
    .eq('id', loanId)
    .single()
  if (!loan) return

  const lo = loan.loan_officers as unknown as { email: string | null } | null
  const lp  = loan.loan_processors as unknown as { email: string | null } | null
  const lp2 = (loan as unknown as { loan_processor_2: { email: string | null } | null }).loan_processor_2

  const contacts = await getLoanContacts(loanId)
  const staffEmails = [lo?.email, lp?.email, lp2?.email].filter((e): e is string => !!e)
  const recipients = buildRecipients(contacts, staffEmails)
  if (recipients.length === 0) return

  const subject = `🎉 Loan Approved — ${loan.property_address ?? 'property'}`
  const bodyHtml = (greeting: string) => `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
        <div style="background-color: #1F5D8F; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; color: white; font-size: 22px;">Loan Approved!</h1>
        </div>
        <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="font-size: 15px; margin-top: 0;">Hi ${greeting},</p>
          <p style="font-size: 15px;">
            Great news, your loan for <strong>${loan.property_address ?? 'your property'}</strong> has been
            <strong style="color: #1F5D8F;">Loan Approved!</strong>
          </p>
          <p style="font-size: 15px;">
            Your loan has been approved by underwriting and submitted to committee for final
            clear-to-close. Our team will be in touch shortly with next steps and closing details.
          </p>
          <p style="font-size: 15px;">
            You can log in to the portal at any time to review your loan details and any remaining items.
          </p>
          <p style="margin-top: 28px;">
            <a href="${PORTAL_URL}"
               style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">
              View Loan
            </a>
          </p>
          <p style="font-size: 14px; color: #555; margin-top: 28px;">
            Congratulations and thank you for choosing First Equity Funding!<br/>
            <strong>The First Equity Funding Team</strong>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 28px;" />
          <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
        </div>
      </div>
    `

  const transporter = getTransporter()
  await Promise.all(recipients.map(r =>
    transporter.sendMail({
      from: `First Equity Funding <${process.env.GMAIL_USER}>`,
      to: r.email,
      subject,
      html: bodyHtml(r.greetingName),
    }).catch(err => console.error(`Loan Approved email to ${r.email} failed:`, err))
  ))
}
