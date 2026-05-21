// Returns the loan's outside contacts for notifications.
//
// Rules:
//  - If a broker is assigned, the broker is the single contact and the
//    borrowers receive nothing (existing brokered-loan rule).
//  - Otherwise, all four borrower slots get notified — primary + co-borrowers —
//    BUT only borrowers who have actually registered in the portal (i.e. have
//    an auth_user_id linked). Borrowers synced from Pipedrive without a
//    portal login don't get update emails; they only get the one-time invite
//    email (sent directly by invite-borrower.ts, which bypasses this helper).
//
// Used by the staff condition routes so adding a broker to a loan
// automatically redirects all borrower-facing emails to the broker, and
// adding a co-borrower to a loan automatically loops them in on emails.

import { createAdminClient } from '@/lib/supabase/admin'
import { PORTAL_URL } from '@/lib/portal-url'

export interface LoanContact {
  name: string | null
  email: string
  /** Where the email "View My Loan" button should link to. */
  portalUrl: string
  /** Identifier for the role — useful for tailored copy if needed. */
  kind: 'borrower' | 'broker'
}

/** Single primary contact — for legacy callers that only handle one. */
export async function getLoanContact(loanId: string): Promise<LoanContact | null> {
  const list = await getLoanContacts(loanId)
  return list[0] ?? null
}

/**
 * Returns every outside contact who should be emailed for this loan.
 * Broker takes priority — when a broker is on the loan we return only
 * the broker. Otherwise returns every non-null borrower slot that has
 * an email on file, deduplicated.
 */
export async function getLoanContacts(loanId: string): Promise<LoanContact[]> {
  const adminClient = createAdminClient()
  const { data: loan } = await adminClient
    .from('loans')
    .select('borrower_id, borrower_id_2, borrower_id_3, borrower_id_4, broker_id, broker_id_2')
    .eq('id', loanId)
    .single()
  if (!loan) return []

  const seenEmails = new Set<string>()
  function pushUnique(out: LoanContact[], c: LoanContact) {
    const k = c.email.toLowerCase()
    if (seenEmails.has(k)) return
    seenEmails.add(k)
    out.push(c)
  }

  // Brokers take priority — if any broker slot is filled, only brokers get
  // emails (borrowers stay silent per the brokered-loan rule).
  const brokerIds = [loan.broker_id, loan.broker_id_2].filter((x): x is string => !!x)
  if (brokerIds.length > 0) {
    const { data: brokers } = await adminClient
      .from('brokers')
      .select('id, full_name, email')
      .in('id', brokerIds)
    const out: LoanContact[] = []
    for (const b of brokers ?? []) {
      if (!b.email) continue
      pushUnique(out, {
        name: b.full_name,
        email: b.email,
        portalUrl: `${PORTAL_URL}/broker`,
        kind: 'broker',
      })
    }
    return out
  }

  // No broker — fan out to every borrower slot
  const borrowerIds = [loan.borrower_id, loan.borrower_id_2, loan.borrower_id_3, loan.borrower_id_4]
    .filter((x): x is string => !!x)
  if (borrowerIds.length === 0) return []

  const { data: borrowers } = await adminClient
    .from('borrowers')
    .select('id, full_name, email, auth_user_id')
    .in('id', borrowerIds)

  const out: LoanContact[] = []
  for (const b of borrowers ?? []) {
    if (!b.email) continue
    // Skip borrowers who haven't accepted their portal invite yet —
    // we don't want to spam someone with stage/condition updates for an
    // account they don't know how to access.
    if (!b.auth_user_id) continue
    pushUnique(out, {
      name: b.full_name,
      email: b.email,
      portalUrl: PORTAL_URL,
      kind: 'borrower',
    })
  }
  return out
}
