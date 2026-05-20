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

  // Prune rows older than 1 hour for this email so the table stays bounded.
  // Fire-and-forget — if this fails, the table just grows; not a security issue.
  void adminClient.from('auth_otp_sends').delete().eq('email', normalized).lt('sent_at', hourAgo)

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
  // Note: the admin SDK does not expose shouldCreateUser for generateLink, so an unknown
  // email will create a ghost auth.users row. This is mitigated at the role-table layer:
  // every page checks for a role row (loan_officers / borrowers / etc.) and redirects to
  // /login if none, so ghost rows have no portal access.
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: normalized,
  })

  // 3. Record the send IMMEDIATELY (before the email goes out) so the rate-limit row is
  //    durable regardless of whether the Resend call throws in a future refactor. Also
  //    records on generateLink error so attackers can't probe for emails by checking
  //    which requests get throttled vs which succeed.
  await adminClient.from('auth_otp_sends').insert({ email: normalized })

  if (linkError || !linkData?.properties?.email_otp || !linkData?.properties?.action_link) {
    console.error('[send-otp] generateLink error:', linkError?.message)
    return NextResponse.json({ success: true })
  }

  // 4. Send the email via Resend (best-effort; errors are swallowed inside sendAuthEmail).
  const { subject, html } = renderSignInCodeEmail({
    code: linkData.properties.email_otp,
    magicLink: linkData.properties.action_link,
  })
  await sendAuthEmail({ to: normalized, subject, html })

  return NextResponse.json({ success: true })
}
