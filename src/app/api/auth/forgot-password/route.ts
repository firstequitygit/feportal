import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendAuthEmail } from '@/lib/emails/send'
import { renderPasswordResetEmail } from '@/lib/emails/auth/password-reset'
import { PORTAL_URL } from '@/lib/portal-url'

const REDIRECT = `${PORTAL_URL}/auth/set-password`

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
    // Don't leak whether the email exists — always return success.
    console.error('[forgot-password] generateLink error:', error?.message)
    return NextResponse.json({ success: true })
  }

  const { subject, html } = renderPasswordResetEmail({ link: data.properties.action_link })
  await sendAuthEmail({ to: email, subject, html })

  return NextResponse.json({ success: true })
}
