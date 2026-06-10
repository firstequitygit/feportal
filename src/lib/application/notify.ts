import { sendApplicationNotifications as _sendBorrowerNotifications } from '@/lib/apply-notify'
import type { ApplicationData } from '@/lib/application-fields'
import type { MappedApplication } from '@/lib/application-mapper'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTransporter } from '@/lib/email'
import { PORTAL_URL, PORTAL_DOMAIN } from '@/lib/portal-url'
import { getPortalSetting } from '@/lib/portal-settings'
import { resolveLoanOfficerEmail } from '@/lib/loan-officer-emails'

export interface NotifyArgs {
  loanId: string
  data: ApplicationData
  m: MappedApplication
  variant?: 'borrower' | 'broker'
  submittedByBrokerId?: string | null
}

/** Borrower-submitted notifications (today's behavior — PDF, borrower email,
 *  internal notice). Kept as a re-export so the call site contract is the same
 *  shape as the future broker/authorization-signed helpers. */
export async function sendBorrowerSubmittedNotifications(args: NotifyArgs) {
  await _sendBorrowerNotifications({ loanId: args.loanId, data: args.data, m: args.m })
}

function fmtAmount(amount: number | null | undefined): string | null {
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

/** Broker-submitted notifications:
 *   1. Broker confirmation email with the forwardable /authorize link.
 *   2. Internal notice to the processing inbox + assigned loan officer. */
export async function sendBrokerSubmittedNotifications(args: NotifyArgs) {
  const { loanId, data, m, submittedByBrokerId } = args
  const admin = createAdminClient()

  // Pull broker info + the freshly-minted authorize_token from the loan row.
  const [{ data: broker }, { data: loan }] = await Promise.all([
    submittedByBrokerId
      ? admin.from('brokers').select('full_name, email, company_name').eq('id', submittedByBrokerId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('loans').select('authorize_token').eq('id', loanId).maybeSingle(),
  ])
  const authorizeToken = (loan?.authorize_token as string | null) ?? null
  const authorizeUrl = authorizeToken ? `${PORTAL_URL}/authorize/${authorizeToken}` : null

  const primary = (data.primary as Record<string, unknown>) ?? {}
  const borrowerName = m.borrowers[0]?.full_name ?? 'the borrower'
  const propertyAddress = m.meta.propertyAddress
  const loanTypeLabel = typeof data.loan_type === 'string' ? data.loan_type : null
  const loanAmount = m.loan.loan_amount
  const amount = fmtAmount(loanAmount)
  const loanOfficerName = m.meta.loanOfficerName
  const brokerageName = (primary.brokerage_name as string | null) ?? (broker?.company_name as string | null) ?? null
  const brokerLicense = (primary.broker_license_number as string | null) ?? null
  const brokerLicenseState = (primary.broker_license_state as string | null) ?? null
  // Broker contact: prefer authenticated brokers row (legacy auth flow), fall
  // back to form-entered values (anonymous public flow).
  const brokerEmail = (broker?.email as string | null) ?? (primary.broker_email as string | null) ?? null
  const brokerFullName = (broker?.full_name as string | null)
    ?? (typeof primary.broker_full_name === 'string' ? (primary.broker_full_name as string) : null)
    ?? brokerageName

  // 1. Broker confirmation email.
  if (brokerEmail && authorizeUrl) {
    const html = wrap('Application submitted - share the authorization link with your borrower', `
      <p style="font-size: 15px; margin-top: 0;">Hi ${brokerFullName?.split(' ')[0] ?? 'there'},</p>
      <p style="font-size: 15px;">
        We've received the loan application you submitted for <strong>${borrowerName}</strong>.
        To finish, your borrower needs to complete the credit authorization and pay the application fee
        at the secure link below. Please forward it to them.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
        <tr><td style="padding:4px 0;color:#6b7280;">Borrower</td><td style="padding:4px 0;"><strong>${borrowerName}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Property</td><td style="padding:4px 0;">${propertyAddress}</td></tr>
        ${loanTypeLabel ? `<tr><td style="padding:4px 0;color:#6b7280;">Loan type</td><td style="padding:4px 0;">${loanTypeLabel}</td></tr>` : ''}
        ${amount ? `<tr><td style="padding:4px 0;color:#6b7280;">Requested amount</td><td style="padding:4px 0;">${amount}</td></tr>` : ''}
      </table>
      <p style="margin-top: 20px;">
        <a href="${authorizeUrl}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Borrower authorization link</a>
      </p>
      <p style="font-size: 12px; color: #6b7280; margin-top: 12px;">
        Or copy and paste: <span style="color:#1F5D8F;">${authorizeUrl}</span>
      </p>
      <p style="font-size: 13px; color: #6b7280; margin-top: 20px;">
        Once the borrower completes the authorization, you and our team will both receive a confirmation.
      </p>`)
    try {
      await getTransporter().sendMail({
        to: brokerEmail,
        subject: 'Application submitted - share the authorization link with your borrower',
        html,
      })
    } catch (err) {
      console.error(`Broker confirmation email to ${brokerEmail} failed:`, err)
    }
  }

  // 2. Internal notice -> processing inbox + assigned LO.
  const dbInbox = await getPortalSetting('applications_processing_inbox')
  const processingInbox = dbInbox ?? process.env.APPLICATIONS_PROCESSING_INBOX ?? null
  const loEmail = await resolveLoanOfficerEmail(loanOfficerName)
  const to = [processingInbox, loEmail].filter((e): e is string => !!e && e.includes('@'))
  if (to.length > 0) {
    const html = wrap('New broker-submitted application', `
      <p style="font-size: 15px; margin-top: 0;">A broker just submitted a new application.</p>
      <p style="font-size: 15px;">
        <strong>Broker:</strong> ${brokerFullName ?? brokerEmail ?? 'Unknown'}${brokerageName && brokerageName !== brokerFullName ? ` (${brokerageName})` : ''}<br/>
        ${brokerLicense ? `<strong>License #:</strong> ${brokerLicense}${brokerLicenseState ? ` (${brokerLicenseState})` : ''}<br/>` : ''}
        <strong>Borrower:</strong> ${borrowerName}<br/>
        <strong>Property:</strong> ${propertyAddress}<br/>
        ${loanTypeLabel ? `<strong>Loan type:</strong> ${loanTypeLabel}<br/>` : ''}
        ${amount ? `<strong>Requested amount:</strong> ${amount}<br/>` : ''}
        <strong>Assigned loan officer:</strong> ${loanOfficerName ?? 'Unassigned'}
      </p>
      <p style="font-size: 13px; color: #6b7280; margin-top: 16px;">
        Borrower has NOT yet completed credit authorization or payment. They'll receive the
        ${authorizeUrl ? `<a href="${authorizeUrl}" style="color:#1F5D8F;">authorization link</a>` : 'authorization link'}
        from the broker.
      </p>
      <p style="margin-top: 20px;">
        <a href="${PORTAL_URL}/admin/loans/${loanId}" style="color:#1F5D8F;font-size:13px;">Open the loan in the portal</a>
      </p>`)
    try {
      await getTransporter().sendMail({
        to,
        subject: `New broker-submitted application - ${propertyAddress}`,
        html,
      })
    } catch (err) {
      console.error(`Broker internal notice to ${to.join(', ')} failed:`, err)
    }
  } else {
    console.warn('Broker internal notice skipped: no processing inbox or LO email resolved.')
  }
}

/** Stub — fleshed out in PR 2/PR 3. Fired when the borrower completes /authorize. */
export async function sendAuthorizationSignedNotifications(_args: NotifyArgs) {
  // Intentionally empty in PR 1; later PRs send the final-authorized notifications.
}
