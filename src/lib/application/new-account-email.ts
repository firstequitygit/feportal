// Sent to a brand-new borrower right after they submit their first application.
// Creates (or links) their Supabase auth account via the shared idempotent
// helper, then emails a single-use sign-in link with application-context copy.
//
// Distinct from invite-borrower.ts (admin "you've been invited" copy): this is
// the post-submission "your application is in, here's how to get into your
// portal" message. Both reuse ensureBorrowerActivationLink for the account work.

import { ensureBorrowerActivationLink } from '@/lib/invite-borrower'
import { sendEmail } from '@/lib/mailer'

export async function sendNewApplicantAccessEmail(email: string, fullName?: string): Promise<void> {
  const link = await ensureBorrowerActivationLink(email, fullName)

  const firstName = (fullName ?? '').trim().split(/\s+/)[0]
  const greetingName = firstName || (fullName ?? '').trim() || 'there'

  await sendEmail({
    to: email,
    subject: 'Your First Equity Funding application was received',
    html: `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${greetingName},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        Thank you for applying with <strong>First Equity Funding</strong>. We have received your
        application and created a secure portal account for you, where you can track your loan,
        upload documents, and message your team.
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        Click the button below to set up access to your portal.
      </p>
      <p style="margin-top: 24px;">
        <a href="${link}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
          Access Your Portal
        </a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
        This link expires in 24 hours and can only be used once. After it expires you can always
        sign in at the portal login with your email and a one-time code.
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">First Equity Funding Online Portal</p>
    `,
  })
}
