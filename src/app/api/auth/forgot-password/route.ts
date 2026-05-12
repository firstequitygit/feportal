import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import nodemailer from 'nodemailer'

const REDIRECT = 'https://portal.descofinancial.com/auth/set-password'

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const adminClient = createAdminClient()

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: REDIRECT },
  })

  if (error || !data) {
    // Don't leak whether the email exists — always return success to the client
    console.error('Password reset link error:', error?.message)
    return NextResponse.json({ success: true })
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  await transporter.sendMail({
    from: `Desco Financial <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Reset your DESCO Financial Portal password',
    html: `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi,</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        We received a request to reset the password for your <strong>DESCO Financial Online Portal</strong> account.
        Click the button below to set a new password.
      </p>
      <p style="margin-top: 24px;">
        <a href="${data.properties.action_link}" style="background-color: #2DC653; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
          Reset Password
        </a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
        This link expires in 24 hours. If you didn't request a password reset, you can safely ignore this email.
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">DESCO Financial Online Portal</p>
    `,
  })

  return NextResponse.json({ success: true })
}
