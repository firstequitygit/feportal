// Returns the loan's primary outside contact for notifications:
// the broker when one is assigned, otherwise the borrower. Used by the
// staff condition routes so adding a broker to a loan automatically
// redirects all borrower-facing emails to the broker.

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

/**
 * Returns the outside contact for the loan, or null if neither exists or
 * has an email. Broker takes priority — when a broker is on the loan we
 * never email the borrower.
 */
export async function getLoanContact(loanId: string): Promise<LoanContact | null> {
  const adminClient = createAdminClient()
  const { data: loan } = await adminClient
    .from('loans')
    .select(`
      broker:brokers(full_name, email),
      borrower:borrowers!borrower_id(full_name, email)
    `)
    .eq('id', loanId)
    .single()
  if (!loan) return null

  const broker = (loan.broker as unknown as { full_name: string | null; email: string | null } | null) ?? null
  if (broker?.email) {
    return {
      name: broker.full_name,
      email: broker.email,
      portalUrl: `${PORTAL_URL}/broker`,
      kind: 'broker',
    }
  }

  const borrower = (loan.borrower as unknown as { full_name: string | null; email: string | null } | null) ?? null
  if (borrower?.email) {
    return {
      name: borrower.full_name,
      email: borrower.email,
      portalUrl: `${PORTAL_URL}`,
      kind: 'borrower',
    }
  }
  return null
}
