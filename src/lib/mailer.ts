// Transactional/notification email helper for the portal (conditions,
// uploads, stage updates, invites, etc.). Auth emails go through
// src/lib/emails/send.ts (sendAuthEmail) instead so the two flows can use
// different From addresses without crossing wires.
//
// Required env vars:
//   RESEND_API_KEY               — Resend project key (shared with auth)
//   PORTAL_EMAIL_FROM (optional) — override the From; defaults to the
//                                  verified irongateportals.com address.

import { getResend } from '@/lib/resend'

export const MAIL_FROM =
  process.env.PORTAL_EMAIL_FROM ??
  'First Equity Funding <firstequity-notifications@irongateportals.com>'

export interface MailAttachment {
  filename: string
  /** File contents — Buffer or base64-encoded string. */
  content: Buffer
}

export interface SendEmailParams {
  to: string | string[]
  subject: string
  html: string
  text?: string
  attachments?: MailAttachment[]
  /** Skip the send (and don't throw) when `to` has no valid recipients. */
  skipIfNoRecipients?: boolean
  /** Accepted but ignored. Kept for back-compat with call sites that still
   *  pass `from: "..."`. Actual From is the constant above. */
  from?: string
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const recipients = Array.isArray(params.to)
    ? params.to.filter(e => !!e && e.includes('@'))
    : (params.to && params.to.includes('@') ? [params.to] : [])
  if (recipients.length === 0) {
    if (params.skipIfNoRecipients) return
    throw new Error('sendEmail: no recipients')
  }

  const resend = getResend()
  const { error } = await resend.emails.send({
    from: MAIL_FROM,
    to: recipients,
    subject: params.subject,
    html: params.html,
    ...(params.text ? { text: params.text } : {}),
    ...(params.attachments && params.attachments.length > 0
      ? { attachments: params.attachments.map(a => ({ filename: a.filename, content: a.content })) }
      : {}),
  })

  if (error) {
    throw new Error(`Resend send failed: ${error.message || JSON.stringify(error)}`)
  }
}
