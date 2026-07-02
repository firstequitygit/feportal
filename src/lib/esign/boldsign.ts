// BoldSign e-signature client. All provider calls go through this
// file so a future provider swap (DocuSign, OpenSign, …) is a
// contained change — routes and UI only know about these functions.
//
// Auth: X-API-KEY header. Sandbox and production use the same API
// host; the key determines the environment (sandbox keys produce
// watermarked test documents that auto-delete after 14 days).
//
// Feature flag: the integration is live only when BOLDSIGN_API_KEY
// is set. UI calls isEsignEnabled() and hides all e-sign affordances
// otherwise — no schema or route changes needed to turn it off.
//
// Env vars:
//   BOLDSIGN_API_KEY        — API key from the BoldSign dashboard
//   BOLDSIGN_WEBHOOK_SECRET — webhook signing secret (Settings → Webhooks)
//   NEXT_PUBLIC_SITE_URL    — absolute origin used for redirect URLs
//                             (falls back to the production portal URL)

import crypto from 'crypto'

const API_BASE = 'https://api.boldsign.com'

export function isEsignEnabled(): boolean {
  return !!process.env.BOLDSIGN_API_KEY
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://firstequity.irongateportals.com'
}

function apiKey(): string {
  const key = process.env.BOLDSIGN_API_KEY
  if (!key) throw new Error('BOLDSIGN_API_KEY is not configured')
  return key
}

export interface SendForSignatureInput {
  title: string
  /** Message shown to the signer in the BoldSign email + signing page. */
  message: string
  pdf: Buffer
  signerName: string
  signerEmail: string
  /** How many days until the request expires. */
  expiryDays?: number
  /** Explicit field placements (fixed-form pipeline). When omitted,
   *  fields are extracted from the {{...}} tags rendered in the PDF
   *  (generated-doc pipeline, e.g. the Term Sheet). */
  formFields?: import('./tag-fields').BoldSignFormField[]
}

export interface SendForSignatureResult {
  documentId: string
}

/**
 * Create a signature request from a rendered PDF. Field placement:
 * the PDF carries invisible {{sign|1|*|…}} tags as position markers;
 * we extract their coordinates server-side and send BoldSign explicit
 * FormFields at those spots.
 *
 * Deliberately NOT UseTextTags — BoldSign's own tag scanning silently
 * fails on our white-rendered tags (doc dies in async processing: no
 * email, invisible in dashboard, 403 on read). Explicit FormFields
 * process reliably. See lib/esign/tag-fields.ts.
 *
 * Emails stay ON so the borrower gets BoldSign's email with a sign
 * link (the "email fallback"). Embedded signing is also enabled so
 * the portal can mint an iframe link for the same signer.
 */
export async function sendForSignature(input: SendForSignatureInput): Promise<SendForSignatureResult> {
  const { title, message, pdf, signerName, signerEmail, expiryDays = 30 } = input

  let fields = input.formFields
  if (!fields || fields.length === 0) {
    const { extractTagFields } = await import('./tag-fields')
    fields = await extractTagFields(pdf)
  }
  if (fields.length === 0) {
    // Without fields the request would either 400 or produce an
    // unsignable document — fail loudly instead.
    throw new Error('No signature fields configured or found in the rendered PDF — cannot send')
  }

  const res = await fetch(`${API_BASE}/v1/document/send`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      Title: title,
      Message: message,
      Files: [`data:application/pdf;base64,${pdf.toString('base64')}`],
      Signers: [
        {
          Name: signerName,
          EmailAddress: signerEmail,
          SignerType: 'Signer',
          // BoldSign bounds are 96-DPI pixels (4/3 x PDF points), origin
          // top-left. Calibrated against fields hand-placed in the
          // BoldSign UI (their stored x values = our PDF points * 4/3).
          // Everything upstream works in PDF points; convert only here.
          FormFields: fields.map((f, i) => ({
            Id: f.id ?? `field_${i + 1}`,
            FieldType: f.fieldType,
            PageNumber: f.pageNumber,
            Bounds: {
              X: f.bounds.x * (96 / 72),
              Y: f.bounds.y * (96 / 72),
              Width: f.bounds.width * (96 / 72),
              Height: f.bounds.height * (96 / 72),
            },
            IsRequired: f.isRequired,
          })),
        },
      ],
      // Deliberately NO EnableEmbeddedSigning — that (deprecated) flag
      // suppresses the signer's email invitation. We want BOTH: the
      // BoldSign email AND the portal's embedded signing, and
      // getEmbeddedSignLink works without the flag.
      DisableEmails: false,
      ExpiryDays: expiryDays,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`BoldSign send failed (${res.status}): ${body.slice(0, 500)}`)
  }

  const json = (await res.json()) as { documentId?: string }
  if (!json.documentId) throw new Error('BoldSign send succeeded but returned no documentId')
  return { documentId: json.documentId }
}

/**
 * Mint a short-lived embedded signing URL for one signer. Generated
 * server-side per request — never store these.
 */
export async function getEmbeddedSignLink(
  documentId: string,
  signerEmail: string,
  redirectUrl: string,
): Promise<string> {
  const params = new URLSearchParams({
    documentId,
    signerEmail,
    redirectUrl,
  })
  const res = await fetch(`${API_BASE}/v1/document/getEmbeddedSignLink?${params}`, {
    headers: { 'X-API-KEY': apiKey() },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`BoldSign sign link failed (${res.status}): ${body.slice(0, 500)}`)
  }
  const json = (await res.json()) as { signLink?: string }
  if (!json.signLink) throw new Error('BoldSign returned no signLink')
  return json.signLink
}

/** Download the (signed/completed) document PDF. */
export async function downloadDocument(documentId: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}/v1/document/download?documentId=${encodeURIComponent(documentId)}`, {
    headers: { 'X-API-KEY': apiKey() },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`BoldSign download failed (${res.status}): ${body.slice(0, 500)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Verify the X-BoldSign-Signature webhook header.
 *
 * Header format: `t=<unix seconds>, s0=<hmac>, s1=<old-secret hmac>`.
 * Signed payload is `<timestamp>.<raw body>`; HMAC-SHA256 with the
 * webhook secret. Constant-time compare; 5-minute replay window.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.BOLDSIGN_WEBHOOK_SECRET
  if (!secret) {
    // No secret configured — fail closed in production, but log
    // loudly so a misconfigured deploy is easy to spot.
    console.error('[boldsign] BOLDSIGN_WEBHOOK_SECRET is not set — rejecting webhook')
    return false
  }
  if (!signatureHeader) return false

  const parts = new Map<string, string>()
  for (const piece of signatureHeader.split(',')) {
    const [k, v] = piece.trim().split('=')
    if (k && v) parts.set(k, v)
  }
  const timestamp = parts.get('t')
  if (!timestamp) return false

  // Replay protection — reject events older than 5 minutes.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  for (const key of ['s0', 's1']) {
    const candidate = parts.get(key)
    if (!candidate) continue
    const a = Buffer.from(expected)
    const b = Buffer.from(candidate)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true
  }
  return false
}
