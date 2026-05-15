// Shared logic for inviting a broker. Mirrors the borrower-invite flow:
// creates (or links to) a Supabase auth user, creates a `brokers` row if
// new, generates a recovery link, and emails it directly to the broker
// via the existing Gmail SMTP transport.
//
// Used by /api/invite-broker (admin), /api/loan-officer/invite-broker,
// and /api/loan-processor/invite-broker. Each role-scoped route handles
// its own permission check before calling this.

import { createAdminClient } from '@/lib/supabase/admin'
import { PORTAL_URL } from '@/lib/portal-url'
import nodemailer from 'nodemailer'

export interface InviteBrokerInput {
  email: string
  fullName?: string
  companyName?: string
}

export interface InviteBrokerResult {
  brokerId: string
  inviteLink: string
  emailSent: boolean
  emailError: string | null
}

export async function inviteBroker(input: InviteBrokerInput): Promise<InviteBrokerResult> {
  const { email, fullName, companyName } = input
  const adminClient = createAdminClient()

  // Three cases mirroring the borrower flow:
  //   1. No broker row → create auth user + broker row
  //   2. Broker row exists but auth_user_id is NULL → create auth user, link
  //   3. Already linked → just regenerate the recovery email
  const { data: existing } = await adminClient
    .from('brokers')
    .select('id, auth_user_id')
    .eq('email', email)
    .maybeSingle()

  let brokerId = existing?.id ?? null

  if (!existing) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: 'broker' },
    })
    if (authError) throw new Error(authError.message)

    const { data: broker, error: brokerError } = await adminClient
      .from('brokers')
      .insert({
        auth_user_id: authUser.user.id,
        email,
        full_name: fullName ?? null,
        company_name: companyName ?? null,
      })
      .select('id')
      .single()
    if (brokerError) throw new Error(brokerError.message)
    brokerId = broker.id
  } else if (!existing.auth_user_id) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: 'broker' },
    })
    if (authError) throw new Error(authError.message)

    const { error: linkError } = await adminClient
      .from('brokers')
      .update({
        auth_user_id: authUser.user.id,
        full_name: fullName ?? undefined,
        company_name: companyName ?? undefined,
      })
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
          You've been invited to the <strong>First Equity Funding Online Portal</strong>
          ${companyName ? ` on behalf of <strong>${companyName}</strong>` : ''} to manage your
          brokered loan files, track conditions, upload documents, and message your team.
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
    console.error('Invite broker email error:', emailError)
  }

  return { brokerId: brokerId!, inviteLink, emailSent, emailError }
}
