// Shared logic for inviting a borrower. Mirrors the broker-invite flow:
// creates (or links to) a Supabase auth user, creates a `borrowers` row
// if new, generates a recovery link pointing at /auth/welcome, and emails
// it directly to the borrower via Gmail SMTP.
//
// Used by /api/invite (admin), /api/loan-officer/invite, and
// /api/loan-processor/invite. Each role-scoped route handles its own
// permission check before calling this.

import { createAdminClient } from '@/lib/supabase/admin'
import { PORTAL_URL } from '@/lib/portal-url'
import nodemailer from 'nodemailer'

export interface InviteBorrowerInput {
  email: string
  fullName?: string
}

export interface InviteBorrowerResult {
  borrowerId: string | null
  inviteLink: string
  emailSent: boolean
  emailError: string | null
}

export async function inviteBorrower(input: InviteBorrowerInput): Promise<InviteBorrowerResult> {
  const { email, fullName } = input
  const adminClient = createAdminClient()

  // Three cases:
  //   1. No borrower row → create auth user + borrower row
  //   2. Row exists but auth_user_id is NULL (JotForm intake) → create
  //      auth user and link to existing row
  //   3. Row already linked → fall through to recovery email
  const { data: existing } = await adminClient
    .from('borrowers')
    .select('id, auth_user_id')
    .eq('email', email)
    .maybeSingle()

  let borrowerId = existing?.id ?? null

  if (!existing) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (authError) throw new Error(authError.message)

    const { data: borrower, error: borrowerError } = await adminClient
      .from('borrowers')
      .insert({ auth_user_id: authUser.user.id, email, full_name: fullName ?? null })
      .select('id').single()
    if (borrowerError) throw new Error(borrowerError.message)
    borrowerId = borrower.id
  } else if (!existing.auth_user_id) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (authError) throw new Error(authError.message)

    const { error: linkError } = await adminClient
      .from('borrowers')
      .update({ auth_user_id: authUser.user.id, full_name: fullName ?? undefined })
      .eq('id', existing.id)
    if (linkError) throw new Error(linkError.message)
  }

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${PORTAL_URL}/auth/welcome` },
  })
  if (linkError || !linkData) throw new Error(linkError?.message ?? 'Failed to generate invite link')

  const inviteLink = linkData.properties.action_link
  const firstName = (fullName ?? '').trim().split(/\s+/)[0]
  const greetingName = firstName || (fullName ?? '').trim() || 'there'

  let emailSent = false
  let emailError: string | null = null
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    })
    await transporter.sendMail({
      from: `First Equity Funding <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `You've been invited to the First Equity Funding Online Portal`,
      html: `
        <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${greetingName},</p>
        <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
          You've been invited to the <strong>First Equity Funding Online Portal</strong>, where you can track
          your loan, upload required documents, and message your team.
        </p>
        <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
          Click the button below to create a password and access your portal.
        </p>
        <p style="margin-top: 24px;">
          <a href="${inviteLink}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
            Set Up My Account
          </a>
        </p>
        <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
          This link expires in 24 hours and can only be used once. If you didn't expect this invitation,
          you can ignore this email.
        </p>
        <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">First Equity Funding Online Portal</p>
      `,
    })
    emailSent = true
  } catch (err) {
    emailError = err instanceof Error ? err.message : 'Unknown email error'
    console.error('Invite borrower email error:', emailError)
  }

  return { borrowerId, inviteLink, emailSent, emailError }
}
