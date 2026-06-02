// Server helper for the @mention pipeline.
//
// Called from POST routes that accept a text body (staff notes,
// condition notes, condition response). Takes the list of mention refs
// the client sent alongside the text and:
//   1. Validates that each ref points at an actual staff row (skips
//      anything not found — safer than letting a typo'd id create an
//      orphan mention).
//   2. Resolves the email + display name for each (admins live in
//      admin_users, staff in their role table).
//   3. Inserts one mentions row per recipient.
//   4. Sends "@You were mentioned" emails.
//
// All failures are logged but never thrown — the parent write has
// already landed and the audit trail captures the mention rows we did
// successfully create.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/mailer'
import { PORTAL_URL } from '@/lib/portal-url'
import { fetchLoanEmailContext, loanContextBlockHtml } from '@/lib/email-loan-context'

type AdminClient = SupabaseClient

type Kind = 'admin' | 'loan_officer' | 'loan_processor' | 'underwriter'
type SourceKind = 'staff_note' | 'condition_note' | 'condition_response'

export interface IncomingMentionRef {
  kind: Kind
  id: string
  /** Display name as the client saw it. We re-fetch to authoritative below. */
  full_name?: string
}

interface Params {
  adminClient: AdminClient
  /** Who tagged them (used in the email + audit row). */
  authorName: string
  /** Source row metadata. */
  loanId: string
  conditionId?: string | null
  sourceKind: SourceKind
  sourceId: string
  /** Full text of the message — used to compute the excerpt. */
  text: string
  /** What the client sent (likely already deduped). */
  mentions: IncomingMentionRef[]
}

const TABLE_BY_KIND: Record<Kind, string> = {
  admin:          'admin_users',
  loan_officer:   'loan_officers',
  loan_processor: 'loan_processors',
  underwriter:    'underwriters',
}

const PORTAL_PATH_BY_KIND: Record<Kind, string> = {
  // Admins don't have an /inbox today, so link them to /admin.
  admin:          '/admin',
  loan_officer:   '/loan-officer/inbox',
  loan_processor: '/loan-processor/inbox',
  underwriter:    '/underwriter/inbox',
}

const SOURCE_LABEL: Record<SourceKind, string> = {
  staff_note:         'staff note',
  condition_note:     'condition note',
  condition_response: 'condition response',
}

/**
 * Short text around the @-token. Cuts the message down to a single
 * line worth of context for the inbox row.
 */
function makeExcerpt(text: string, max = 180): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

export async function processMentions({
  adminClient,
  authorName,
  loanId,
  conditionId = null,
  sourceKind,
  sourceId,
  text,
  mentions,
}: Params): Promise<{ created: number }> {
  if (mentions.length === 0) return { created: 0 }

  // Dedup by kind+id in case the client sent duplicates.
  const seen = new Set<string>()
  const unique = mentions.filter(m => {
    const k = `${m.kind}:${m.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  // Fetch property + borrower + LO for the email subject and context block.
  let propertyAddress = 'a loan'
  let contextBlock = ''
  try {
    const ctx = await fetchLoanEmailContext(adminClient, loanId)
    if (ctx.propertyAddress) propertyAddress = ctx.propertyAddress
    contextBlock = loanContextBlockHtml({
      borrowerName: ctx.borrowerName,
      loanOfficerName: ctx.loanOfficerName,
    })
  } catch { /* keep defaults — email still useful */ }

  const excerpt = makeExcerpt(text)
  let created = 0

  for (const m of unique) {
    try {
      // Validate the id against the right table — typos / spoofed ids
      // get dropped silently so we don't create orphaned mentions.
      const { data: row } = await adminClient
        .from(TABLE_BY_KIND[m.kind])
        .select('id, full_name, email')
        .eq('id', m.id)
        .maybeSingle()
      if (!row) continue

      const { error } = await adminClient.from('mentions').insert({
        mentioned_user_kind: m.kind,
        mentioned_user_id:   m.id,
        mentioned_by_name:   authorName,
        source_kind:         sourceKind,
        source_id:           sourceId,
        loan_id:             loanId,
        condition_id:        conditionId,
        excerpt,
      })
      if (error) { console.error('mention insert failed:', error.message); continue }
      created++

      // Send the notification email. Failures here don't roll back the
      // mention row — the recipient still sees the row in their inbox.
      if (row.email) {
        const portalPath = PORTAL_PATH_BY_KIND[m.kind]
        const sourceLabel = SOURCE_LABEL[sourceKind]
        const safeAuthor = authorName || 'A teammate'
        const safeName = (row.full_name as string | null) ?? 'there'
        try {
          await sendEmail({
            to: row.email,
            subject: `${safeAuthor} mentioned you — ${propertyAddress}`,
            html: `
              <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${safeName},</p>
              <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
                <strong>${safeAuthor}</strong> mentioned you in a ${sourceLabel} on <strong>${propertyAddress}</strong>.
              </p>
              ${contextBlock}
              <blockquote style="font-family: Arial, sans-serif; font-size: 14px; color: #555; border-left: 3px solid #1F5D8F; padding: 8px 12px; margin: 12px 0; background: #f8fafc;">
                ${escapeHtml(excerpt)}
              </blockquote>
              <p style="margin-top: 16px;">
                <a href="${PORTAL_URL}${portalPath}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px;">View in Portal</a>
              </p>
              <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">First Equity Funding Online Portal</p>
            `,
          })
        } catch (err) {
          console.error('mention email failed:', err instanceof Error ? err.message : err)
        }
      }
    } catch (err) {
      console.error('mention processing error:', err instanceof Error ? err.message : err)
    }
  }

  return { created }
}

// Minimal HTML escape — mention excerpts go straight into a blockquote.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
