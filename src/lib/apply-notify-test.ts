import type { ApplicationData } from '@/lib/application-fields'
import { sendEmail } from '@/lib/mailer'
import { PORTAL_DOMAIN } from '@/lib/portal-url'

export interface TestOverrides {
  borrowerEmail: string
  processingInbox: string
  loEmail: string
}

export interface TestNotifyArgs {
  data: ApplicationData
  pdf: Buffer
  overrides: TestOverrides
  scenarioLabel: string | null
}

export interface TestNotifyResult {
  borrower: string | null
  internal: string[]
  pdfBytes: number
}

function validEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)
}

function fmtAmount(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return null
  return `$${Number(amount).toLocaleString('en-US')}`
}

function wrap(title: string, bodyHtml: string) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
      <div style="background-color: #b45309; padding: 12px 28px; border-radius: 8px 8px 0 0;">
        <p style="margin: 0; color: #fffbeb; font-size: 12px; font-weight: bold; letter-spacing: 0.5px;">TEST MODE - NOT A REAL APPLICATION</p>
      </div>
      <div style="background-color: #1F5D8F; padding: 20px 28px;">
        <h1 style="margin: 0; color: white; font-size: 18px;">${title}</h1>
      </div>
      <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        ${bodyHtml}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 20px;" />
        <p style="font-size: 11px; color: #9ca3af; margin-bottom: 0;">First Equity Funding Online Portal &nbsp;·&nbsp; ${PORTAL_DOMAIN}</p>
      </div>
    </div>`
}

export async function sendApplicationTestNotifications(args: TestNotifyArgs): Promise<TestNotifyResult> {
  const { data, pdf, overrides, scenarioLabel } = args

  const primary = (data.primary as Record<string, unknown>) ?? {}
  const primaryFirstName = (primary.first_name as string | undefined) ?? null
  const primaryFullName = [primary.first_name, primary.last_name].filter(Boolean).join(' ') || 'Test Applicant'
  const propertyAddress = [data.property_street, data.property_city, data.property_state, data.property_zip]
    .filter(Boolean).join(', ') || 'test property'
  const loanType = typeof data.loan_type === 'string' ? data.loan_type : null
  const loanAmount = typeof data.requested_loan_amount === 'number' ? data.requested_loan_amount : null
  const loanOfficerName = typeof data.loan_officer_assigned === 'string' ? data.loan_officer_assigned : null
  const amountLabel = fmtAmount(loanAmount)

  const result: TestNotifyResult = { borrower: null, internal: [], pdfBytes: pdf.length }

  // 1. Borrower-style email.
  if (validEmail(overrides.borrowerEmail)) {
    const recapRows = [
      `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Property</td><td style="padding:4px 0;font-size:13px;"><strong>${propertyAddress}</strong></td></tr>`,
      loanType ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Loan type</td><td style="padding:4px 0;font-size:13px;">${loanType}</td></tr>` : '',
      amountLabel ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Requested amount</td><td style="padding:4px 0;font-size:13px;">${amountLabel}</td></tr>` : '',
    ].join('')
    const html = wrap('Application received', `
      <p style="font-size: 15px; margin-top: 0;">Hi ${primaryFirstName ?? 'there'},</p>
      <p style="font-size: 15px;">We've received your loan application. Our team will review it and reach out with next steps.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">${recapRows}</table>
      <p style="font-size: 13px; color: #92400e; background:#fef3c7; padding:10px 14px; border-radius:6px;">Test mode - activation link not generated.</p>`)
    try {
      await sendEmail({
        to: overrides.borrowerEmail,
        subject: '[TEST] We received your First Equity loan application',
        html,
      })
      result.borrower = overrides.borrowerEmail
    } catch (err) {
      console.error('Test borrower email failed:', err)
    }
  }

  // 2. Internal email with PDF attached inline.
  const internalRecipients = Array.from(new Set(
    [overrides.processingInbox, overrides.loEmail].filter(validEmail),
  ))
  if (internalRecipients.length > 0) {
    const scenarioLine = scenarioLabel
      ? `<p style="font-size: 13px; color: #92400e; background:#fef3c7; padding:8px 12px; border-radius:6px;">Scenario: <strong>${scenarioLabel}</strong></p>`
      : ''
    const html = wrap('New loan application', `
      ${scenarioLine}
      <p style="font-size: 15px; margin-top: 0;">A test application was submitted.</p>
      <p style="font-size: 15px;">
        <strong>Applicant:</strong> ${primaryFullName}<br/>
        <strong>Property:</strong> ${propertyAddress}<br/>
        ${loanType ? `<strong>Loan type:</strong> ${loanType}<br/>` : ''}
        ${amountLabel ? `<strong>Requested amount:</strong> ${amountLabel}<br/>` : ''}
        <strong>Assigned loan officer:</strong> ${loanOfficerName ?? 'Unassigned'}
      </p>
      <p style="font-size: 13px; color: #6b7280;">The application PDF is attached to this email.</p>`)
    try {
      await sendEmail({
        to: internalRecipients,
        subject: `[TEST] New loan application - ${propertyAddress}`,
        html,
        attachments: [{ filename: `Test Application - ${propertyAddress}.pdf`, content: pdf }],
      })
      result.internal = internalRecipients
    } catch (err) {
      console.error('Test internal email failed:', err)
    }
  }

  return result
}
