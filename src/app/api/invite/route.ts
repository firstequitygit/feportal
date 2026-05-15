import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import nodemailer from 'nodemailer'

export async function POST(request: Request) {
  // Verify the requester is an admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()

  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email, fullName } = await request.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  // Check if a borrower row already exists for this email. Three cases:
  //   1. No row at all → create auth user + borrower row
  //   2. Row exists but auth_user_id is NULL (JotForm intake created it
  //      without an auth user) → create the auth user and link it to
  //      the existing row
  //   3. Row exists and is already linked → just resend a recovery email
  const { data: existing } = await adminClient
    .from('borrowers')
    .select('id, auth_user_id')
    .eq('email', email)
    .maybeSingle()

  let borrowerId = existing?.id ?? null

  if (!existing) {
    // Case 1
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

    const { data: borrower, error: borrowerError } = await adminClient
      .from('borrowers')
      .insert({
        auth_user_id: authUser.user.id,
        email,
        full_name: fullName,
      })
      .select('id')
      .single()
    if (borrowerError) return NextResponse.json({ error: borrowerError.message }, { status: 500 })
    borrowerId = borrower.id
  } else if (!existing.auth_user_id) {
    // Case 2 — JotForm-created borrower row that's never been invited
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

    const { error: linkError } = await adminClient
      .from('borrowers')
      .update({ auth_user_id: authUser.user.id, full_name: fullName ?? undefined })
      .eq('id', existing.id)
    if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 })
  }
  // Case 3 (existing row already linked): fall through to generateLink — sends recovery email

  // Generate invite link pointing directly to /auth/welcome
  // The browser Supabase client handles the hash token on that page
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/welcome`,
    },
  })

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 })
  }

  const inviteLink = linkData.properties.action_link
  const firstName = (fullName ?? '').trim().split(/\s+/)[0] ?? ''
  const greetingName = firstName ? firstName : (fullName ?? '').trim() || 'there'

  // Send the invite email. If SMTP fails, still return success with the link
  // so the admin can copy/paste as a fallback rather than blocking the flow.
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
    console.error('Invite email error:', emailError)
  }

  return NextResponse.json({
    success: true,
    borrowerId,
    emailSent,
    emailError,
    // Returned so the admin UI can offer a "copy link" fallback if email fails.
    inviteLink,
  })
}
