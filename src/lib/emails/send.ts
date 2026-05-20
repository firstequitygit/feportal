import { getResend } from '@/lib/resend'

const FROM = process.env.AUTH_EMAIL_FROM ?? 'First Equity Funding <auth@fefunding.com>'

export type AuthEmail = {
  to: string
  subject: string
  html: string
}

/**
 * Single chokepoint for all auth-related transactional emails.
 * Logs Resend errors server-side but never throws — callers should treat
 * the operation as best-effort and respond identically to the client
 * regardless of outcome (to prevent enumeration in flows like send-otp).
 */
export async function sendAuthEmail({ to, subject, html }: AuthEmail): Promise<{ id: string | null }> {
  const resend = getResend()
  const { data, error } = await resend.emails.send({ from: FROM, to, subject, html })
  if (error) {
    console.error('[sendAuthEmail] Resend error:', error)
    return { id: null }
  }
  return { id: data?.id ?? null }
}
