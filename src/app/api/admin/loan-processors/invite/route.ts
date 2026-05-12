import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import nodemailer from 'nodemailer'

const REDIRECT = 'https://portal.descofinancial.com/auth/set-password'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanProcessorId } = await req.json()
  if (!loanProcessorId) return NextResponse.json({ error: 'Missing loanProcessorId' }, { status: 400 })

  const { data: lp } = await adminClient
    .from('loan_processors').select('*').eq('id', loanProcessorId).single()
  if (!lp) return NextResponse.json({ error: 'Loan processor not found' }, { status: 404 })
  if (!lp.email) return NextResponse.json({ error: 'Loan processor has no email address' }, { status: 400 })

  let linkData, authUserId: string

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.generateLink({
    type: 'invite',
    email: lp.email,
    options: { redirectTo: REDIRECT },
  })

  if (inviteError) {
    const { data: recoveryData, error: recoveryError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: lp.email,
      options: { redirectTo: REDIRECT },
    })
    if (recoveryError || !recoveryData) {
      return NextResponse.json({ error: recoveryError?.message ?? 'Failed to generate portal access link' }, { status: 500 })
    }
    linkData = recoveryData
    authUserId = recoveryData.user.id
  } else {
    if (!inviteData) return NextResponse.json({ error: 'Failed to generate invite link' }, { status: 500 })
    linkData = inviteData
    authUserId = inviteData.user.id
  }

  const { error: linkError, count } = await adminClient
    .from('loan_processors')
    .update({ auth_user_id: authUserId }, { count: 'exact' })
    .eq('id', loanProcessorId)
    .select()

  if (linkError) {
    console.error('Failed to link auth user to loan processor:', linkError)
    return NextResponse.json(
      { error: `Could not link auth user: ${linkError.message}` },
      { status: 500 },
    )
  }
  if (!count) {
    return NextResponse.json(
      { error: 'Auth user created, but loan processor row was not updated. Contact support.' },
      { status: 500 },
    )
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  await transporter.sendMail({
    from: `Desco Financial <${process.env.GMAIL_USER}>`,
    to: lp.email,
    subject: 'Your DESCO Financial Online Portal access',
    html: `
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${lp.full_name ?? 'there'},</p>
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
        You've been given access to the <strong>DESCO Financial Online Portal</strong> as a Loan Processor.
        Click the button below to set your password and access your loan files.
      </p>
      <p style="margin-top: 24px;">
        <a href="${linkData.properties.action_link}" style="background-color: #2DC653; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
          Set Password &amp; Sign In
        </a>
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
        This link expires in 24 hours. If you did not expect this email, you can ignore it.
      </p>
      <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">DESCO Financial Online Portal</p>
    `,
  })

  return NextResponse.json({ success: true })
}
