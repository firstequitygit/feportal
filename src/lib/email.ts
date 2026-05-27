import { createAdminClient } from './supabase/admin'
import { PORTAL_URL, PORTAL_DOMAIN } from './portal-url'
import { getLoanContacts } from './loan-contact'
import { sendEmail } from './mailer'

/**
 * Back-compat shim. Earlier this file exposed a nodemailer transporter via
 * getTransporter(); some routes still call `getTransporter().sendMail(...)`.
 * Keep the surface but route everything through the new sendEmail() helper
 * (Resend). Accepts and ignores `from` so existing callers compile.
 */
export function getTransporter() {
  return {
    async sendMail(opts: {
      from?: string
      to: string | string[]
      subject: string
      html: string
      attachments?: Array<{ filename: string; content: Buffer }>
    }) {
      await sendEmail({
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        attachments: opts.attachments,
      })
    },
  }
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
      to: r.email,
      subject,
      html: bodyHtml(r.greetingName),
    }).catch(err => console.error(`Loan Approved email to ${r.email} failed:`, err))
  ))
}

/**
 * Notify every active underwriter that a loan just moved into
 * Pre-Underwriting so one of them can claim it from /underwriter/loans.
 *
 * Skipped automatically if the loan already has an underwriter assigned
 * (no point pinging the team for a loan that's already spoken for).
 */
export async function sendPreUnderwritingClaimEmail(loanId: string) {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address, loan_number, loan_amount, loan_type, underwriter_id')
    .eq('id', loanId)
    .single()
  if (!loan) return
  if (loan.underwriter_id) {
    // Already claimed — no team-wide blast needed.
    return
  }

  const { data: underwriters } = await adminClient
    .from('underwriters')
    .select('full_name, email')
  const recipients = (underwriters ?? [])
    .filter((u): u is { full_name: string | null; email: string } => !!u.email)
  if (recipients.length === 0) return

  const property = loan.property_address ?? 'a new loan'
  const subject = `New loan ready for underwriting — ${property}`

  const detailRows = [
    loan.loan_number ? ['Loan #', loan.loan_number] : null,
    loan.loan_type ? ['Type', loan.loan_type] : null,
    loan.loan_amount ? ['Amount', new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(loan.loan_amount)] : null,
  ].filter((r): r is [string, string] => !!r)

  const bodyHtml = (greetingName: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
      <div style="background-color: #1F5D8F; padding: 20px 28px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; color: white; font-size: 18px;">Ready for Underwriting</h1>
      </div>
      <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 15px; margin-top: 0;">Hi ${greetingName},</p>
        <p style="font-size: 15px;">
          A loan has moved into <strong style="color: #1F5D8F;">Pre-Underwriting</strong> and is
          available to claim.
        </p>
        <table style="font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
          <tr><td style="padding: 4px 16px 4px 0; color: #666;">Property</td><td><strong>${property}</strong></td></tr>
          ${detailRows.map(([k, v]) => `<tr><td style="padding: 4px 16px 4px 0; color: #666;">${k}</td><td><strong>${v}</strong></td></tr>`).join('')}
        </table>
        <p style="margin-top: 24px;">
          <a href="${PORTAL_URL}/underwriter/loans"
             style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">
            Claim Loan
          </a>
        </p>
        <p style="font-size: 13px; color: #555; margin-top: 24px;">— The First Equity Funding Team</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
        <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
      </div>
    </div>
  `

  await Promise.all(recipients.map(r => {
    const first = r.full_name ? r.full_name.split(/\s+/)[0] : 'there'
    return getTransporter().sendMail({
      to: r.email,
      subject,
      html: bodyHtml(first),
    }).catch(err => console.error(`Pre-Underwriting claim email to ${r.email} failed:`, err))
  }))
}

/**
 * Hardcoded alert to Omayra (LP) every time a loan hits 'Conditionally
 * Approved'. She tracks the conditionally-approved pipeline and wants a
 * heads-up the moment each loan lands there. Includes a full loan summary
 * so she can act without opening the portal first.
 *
 * The 'Conditionally Approved' stage is portal-only — it doesn't exist in
 * Pipedrive or Airtable — so this email only ever fires from
 * /api/loans/stage. Sync routes preserve the stage but never set it from
 * scratch.
 */
const OMAYRA_EMAIL = 'ocartagena@fefunding.com'

export async function sendConditionallyApprovedAlert(loanId: string) {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select(`
      id, property_address, loan_number, loan_amount, loan_type,
      borrowers!borrower_id(full_name),
      loan_officers(full_name),
      loan_processors!loan_processor_id(full_name),
      loan_processor_2:loan_processors!loan_processor_id_2(full_name),
      underwriters(full_name)
    `)
    .eq('id', loanId)
    .single()
  if (!loan) return

  const borrower = (loan.borrowers as unknown as { full_name: string | null } | null)?.full_name ?? null
  const lo = (loan.loan_officers as unknown as { full_name: string | null } | null)?.full_name ?? null
  const lp1 = (loan.loan_processors as unknown as { full_name: string | null } | null)?.full_name ?? null
  const lp2 = ((loan as unknown as { loan_processor_2: { full_name: string | null } | null }).loan_processor_2)?.full_name ?? null
  const uw = (loan.underwriters as unknown as { full_name: string | null } | null)?.full_name ?? null

  const property = loan.property_address ?? 'a loan'
  const subject = `Conditionally Approved — ${property}`

  const detailRows: [string, string][] = [
    ['Property', property],
    ...(loan.loan_number ? [['Loan #', loan.loan_number] as [string, string]] : []),
    ...(borrower ? [['Borrower', borrower] as [string, string]] : []),
    ...(loan.loan_type ? [['Type', loan.loan_type] as [string, string]] : []),
    ...(loan.loan_amount ? [['Amount', new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(loan.loan_amount)] as [string, string]] : []),
    ...(lo ? [['Loan Officer', lo] as [string, string]] : []),
    ...(lp1 ? [['Loan Processor', lp2 ? `${lp1}, ${lp2}` : lp1] as [string, string]] : []),
    ...(uw ? [['Underwriter', uw] as [string, string]] : []),
  ]

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
      <div style="background-color: #0D9488; padding: 20px 28px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; color: white; font-size: 18px;">Loan Conditionally Approved</h1>
      </div>
      <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 15px; margin-top: 0;">Hi Omayra,</p>
        <p style="font-size: 15px;">
          A loan has moved into <strong style="color: #0D9488;">Conditionally Approved</strong>.
        </p>
        <table style="font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">
          ${detailRows.map(([k, v]) => `<tr><td style="padding: 4px 16px 4px 0; color: #666;">${k}</td><td><strong>${v}</strong></td></tr>`).join('')}
        </table>
        <p style="margin-top: 24px;">
          <a href="${PORTAL_URL}/loan-processor/loans/${loan.id}"
             style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">
            Open Loan
          </a>
        </p>
        <p style="font-size: 13px; color: #555; margin-top: 24px;">— The First Equity Funding Team</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
        <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
      </div>
    </div>
  `

  await getTransporter().sendMail({
    to: OMAYRA_EMAIL,
    subject,
    html,
  }).catch(err => console.error(`Conditionally Approved alert to ${OMAYRA_EMAIL} failed:`, err))
}
﻿function fmtAmount(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return null
  return `$${Number(amount).toLocaleString('en-US')}`
}

const wrap = (title: string, bodyHtml: string) => `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
    <div style="background-color: #1F5D8F; padding: 20px 28px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; color: white; font-size: 18px;">${title}</h1>
    </div>
    <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
      ${bodyHtml}
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
      <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
    </div>
  </div>`

export async function sendApplicationResumeEmail(email: string, token: string, firstName: string | null) {
  const link = `${PORTAL_URL}/apply/resume/${token}`
  const html = wrap('Your loan application - saved', `
    <p style="font-size: 15px; margin-top: 0;">Hi ${firstName ?? 'there'},</p>
    <p style="font-size: 15px;">Your loan application has been saved. You can return any time using the secure link below - your answers will be exactly where you left off.</p>
    <p style="margin-top: 24px;">
      <a href="${link}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Resume application</a>
    </p>
    <p style="font-size: 13px; color: #555; margin-top: 24px;">Keep this email - the link is private to you.</p>`)
  await getTransporter().sendMail({
    from: `First Equity Funding <${process.env.GMAIL_USER}>`,
    to: email, subject: 'Resume your First Equity loan application', html,
  }).catch(err => console.error(`Resume email to ${email} failed:`, err))
}

export async function sendApplicationSubmittedEmail(
  email: string,
  firstName: string | null,
  propertyAddress: string,
  activationLink: string | null,
  recap?: { loanType?: string | null; loanAmount?: number | null },
) {
  const amount = fmtAmount(recap?.loanAmount)
  const recapRows = [
    `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Property</td><td style="padding:4px 0;font-size:13px;"><strong>${propertyAddress}</strong></td></tr>`,
    recap?.loanType ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Loan type</td><td style="padding:4px 0;font-size:13px;">${recap.loanType}</td></tr>` : '',
    amount ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Requested amount</td><td style="padding:4px 0;font-size:13px;">${amount}</td></tr>` : '',
  ].join('')

  const activationBlock = activationLink ? `
    <p style="font-size: 15px;">Activate your portal account to track your loan, upload documents, and message your team.</p>
    <p style="margin-top: 20px;">
      <a href="${activationLink}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Activate your portal account</a>
    </p>
    <p style="font-size: 12px; color: #999; margin-top: 16px;">This link is private to you and expires in 24 hours.</p>` : ''

  const html = wrap('Application received', `
    <p style="font-size: 15px; margin-top: 0;">Hi ${firstName ?? 'there'},</p>
    <p style="font-size: 15px;">We've received your loan application. Our team will review it and reach out with next steps. Thank you for choosing First Equity Funding.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">${recapRows}</table>
    ${activationBlock}`)

  await getTransporter().sendMail({
    to: email, subject: 'We received your First Equity loan application', html,
  }).catch(err => console.error(`Submitted email to ${email} failed:`, err))
}

export async function sendApplicationInternalNotice(opts: {
  to: string[]
  applicantName: string
  propertyAddress: string
  loanType: string | null
  loanAmount: number | null
  loanId: string
  pdfUrl: string | null
  loanOfficerName: string | null
}) {
  const amount = fmtAmount(opts.loanAmount)
  const pdfButton = opts.pdfUrl ? `
    <p style="margin-top: 20px;">
      <a href="${opts.pdfUrl}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Download application (PDF)</a>
    </p>
    <p style="font-size: 12px; color: #6b7280;">The application is also saved to the loan in the portal.</p>`
    : `<p style="font-size: 13px; color: #b91c1c;">Application PDF could not be generated; check the loan in the portal.</p>`

  const html = wrap('New loan application', `
    <p style="font-size: 15px; margin-top: 0;">A new application was submitted.</p>
    <p style="font-size: 15px;">
      <strong>Applicant:</strong> ${opts.applicantName}<br/>
      <strong>Property:</strong> ${opts.propertyAddress}<br/>
      ${opts.loanType ? `<strong>Loan type:</strong> ${opts.loanType}<br/>` : ''}
      ${amount ? `<strong>Requested amount:</strong> ${amount}<br/>` : ''}
      <strong>Assigned loan officer:</strong> ${opts.loanOfficerName ?? 'Unassigned'}
    </p>
    ${pdfButton}
    <p style="margin-top: 20px;">
      <a href="${PORTAL_URL}/admin/loans/${opts.loanId}" style="color:#1F5D8F;font-size:13px;">Open the loan in the portal</a>
    </p>`)

  await getTransporter().sendMail({
    to: opts.to,
    subject: `New loan application - ${opts.propertyAddress}`,
    html,
  }).catch(err => console.error(`Internal notice to ${opts.to.join(', ')} failed:`, err))
}
