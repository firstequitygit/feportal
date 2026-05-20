import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendAuthEmail } from '@/lib/emails/send'
import { renderSignInCodeEmail } from '@/lib/emails/auth/sign-in-code'

const COOLDOWN_MS = 60_000           // 60 seconds between sends for same email
const HOURLY_CAP = 5                 // max 5 sends per email per rolling hour

export async function POST(req: NextRequest) {
  const { email } = await req.json()

  // Basic shape check — keep it loose; we'll always return success to the client.
  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ success: true })
  }
  const normalized = email.trim().toLowerCase()

  const adminClient = createAdminClient()

  // 1. Rate-limit checks (server-side; client UI is decorative).
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const cooldownAgo = new Date(Date.now() - COOLDOWN_MS).toISOString()

  const { data: recent } = await adminClient
    .from('auth_otp_sends')
    .select('sent_at')
    .eq('email', normalized)
    .gte('sent_at', hourAgo)
    .order('sent_at', { ascending: false })

  if (recent && recent.length >= HOURLY_CAP) {
    // Silently swallow — caller sees identical "success" response.
    console.warn('[send-otp] hourly cap hit for', normalized)
    return NextResponse.json({ success: true })
  }
  if (recent && recent[0] && recent[0].sent_at > cooldownAgo) {
    // Cooldown window — also swallow.
    console.warn('[send-otp] cooldown active for', normalized)
    return NextResponse.json({ success: true })
  }

  // 2. Generate code + magic link via admin API.
  // 'magiclink' returns both properties.email_otp (6-digit code) and properties.action_link.
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: normalized,
  })

  if (linkError || !linkData?.properties?.email_otp || !linkData?.properties?.action_link) {
    // User likely doesn't exist. Log and return success (no enumeration).
    console.error('[send-otp] generateLink error:', linkError?.message)
    // Still record the attempt for rate limiting, so attackers can't probe for emails by flooding.
    await adminClient.from('auth_otp_sends').insert({ email: normalized })
    return NextResponse.json({ success: true })
  }

  // 3. Send email via Resend.
  const { subject, html } = renderSignInCodeEmail({
    code: linkData.properties.email_otp,
    magicLink: linkData.properties.action_link,
  })
  await sendAuthEmail({ to: normalized, subject, html })

  // 4. Record the send.
  await adminClient.from('auth_otp_sends').insert({ email: normalized })

  return NextResponse.json({ success: true })
}
