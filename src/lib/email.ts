import nodemailer from 'nodemailer'
import { createAdminClient } from './supabase/admin'
import { PORTAL_URL, PORTAL_DOMAIN } from './portal-url'

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
 * Generic stage-change notification sent to borrower + LO + LP for any
 * pipeline stage transition that isn't covered by the specialized
 * Loan Approved / Loan Funded emails. Each recipient gets their
 * own message so the To: header is personalized.
 */
export async function sendStageUpdateEmail(
  loanId: string,
  fromStage: string | null,
  toStage: string,
) {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select('property_address, borrowers(full_name, email), loan_officers(email), loan_processors!loan_processor_id(email)')
    .eq('id', loanId)
    .single()
  if (!loan) return

  const borrower = loan.borrowers as unknown as { full_name: string | null; email: string } | null
  const lo = loan.loan_officers as unknown as { email: string | null } | null
  const lp = loan.loan_processors as unknown as { email: string | null } | null

  const recipients = Array.from(new Set(
    [borrower?.email, lo?.email, lp?.email].filter((e): e is string => !!e),
  ))
  if (recipients.length === 0) return

  const property = loan.property_address ?? 'this property'
  const fromLabel = shortStage(fromStage)
  const toLabel = shortStage(toStage)

  const subject = `Loan stage updated — ${property}`
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
      <div style="background-color: #1F5D8F; padding: 20px 28px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; color: white; font-size: 18px;">Loan stage updated</h1>
      </div>
      <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 15px; margin-top: 0;">Hi ${borrower?.full_name ?? 'there'},</p>
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
  await Promise.all(recipients.map(email =>
    transporter.sendMail({
      from: `First Equity Funding <${process.env.GMAIL_USER}>`,
      to: email,
      subject,
      html,
    }).catch(err => console.error(`Stage update email to ${email} failed:`, err))
  ))
}

export async function sendLoanFundedEmail(loanId: string) {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select('property_address, borrowers(full_name, email), loan_officers(email), loan_processors!loan_processor_id(email)')
    .eq('id', loanId)
    .single()

  if (!loan) return

  const borrower = loan.borrowers as unknown as { full_name: string | null; email: string } | null
  const lo = loan.loan_officers as unknown as { email: string | null } | null
  const lp = loan.loan_processors as unknown as { email: string | null } | null

  const recipients = Array.from(new Set(
    [borrower?.email, lo?.email, lp?.email].filter((e): e is string => !!e),
  ))
  if (recipients.length === 0) return

  const subject = `🏠 Loan funded — ${loan.property_address ?? 'property'}`
  const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
        <div style="background-color: #1F5D8F; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; color: white; font-size: 22px;">Loan Funded!</h1>
        </div>
        <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="font-size: 15px; margin-top: 0;">Hi ${borrower?.full_name ?? 'there'},</p>
          <p style="font-size: 15px;">
            Congratulations — your loan for <strong>${loan.property_address ?? 'your property'}</strong> has been
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
  await Promise.all(recipients.map(email =>
    transporter.sendMail({
      from: `First Equity Funding <${process.env.GMAIL_USER}>`,
      to: email,
      subject,
      html,
    }).catch(err => console.error(`Loan Funded email to ${email} failed:`, err))
  ))
}

export async function sendLoanApprovedEmail(loanId: string) {
  const adminClient = createAdminClient()

  const { data: loan } = await adminClient
    .from('loans')
    .select('property_address, borrowers(full_name, email), loan_officers(email), loan_processors!loan_processor_id(email)')
    .eq('id', loanId)
    .single()

  if (!loan) return

  const borrower = loan.borrowers as unknown as { full_name: string | null; email: string } | null
  const lo = loan.loan_officers as unknown as { email: string | null } | null
  const lp = loan.loan_processors as unknown as { email: string | null } | null

  const recipients = Array.from(new Set(
    [borrower?.email, lo?.email, lp?.email].filter((e): e is string => !!e),
  ))
  if (recipients.length === 0) return

  const subject = `🎉 Loan Approved — ${loan.property_address ?? 'property'}`
  const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
        <div style="background-color: #1F5D8F; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; color: white; font-size: 22px;">Loan Approved!</h1>
        </div>
        <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="font-size: 15px; margin-top: 0;">Hi ${borrower?.full_name ?? 'there'},</p>
          <p style="font-size: 15px;">
            Great news — your loan for <strong>${loan.property_address ?? 'your property'}</strong> has been
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
  await Promise.all(recipients.map(email =>
    transporter.sendMail({
      from: `First Equity Funding <${process.env.GMAIL_USER}>`,
      to: email,
      subject,
      html,
    }).catch(err => console.error(`Loan Approved email to ${email} failed:`, err))
  ))
}
