// Verify the current auth user is the borrower OR broker on a given loan
// (i.e. one of the two portal-facing contacts). Used by routes the borrower
// portal already exposes — uploads, condition responses — so brokers get
// the same capabilities without duplicating endpoints.

import { createAdminClient } from '@/lib/supabase/admin'

export interface ContactAccess {
  loanId: string
  borrowerId: string | null
  brokerId: string | null
  /** Which contact type the auth user is on this loan. */
  role: 'borrower' | 'broker'
}

/**
 * Returns ContactAccess if userId is the borrower or broker on the loan,
 * otherwise null. Broker is checked first since when a broker is on a loan
 * they're the primary contact — but borrower remains a valid fallback so
 * we don't accidentally lock out borrowers who got invited before a broker
 * was added.
 */
export async function verifyContactAccess(
  userId: string,
  loanId: string,
): Promise<ContactAccess | null> {
  const adminClient = createAdminClient()

  // Pull the loan first so we have both borrower_id and broker_id
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, borrower_id, broker_id')
    .eq('id', loanId)
    .maybeSingle()
  if (!loan) return null

  // Try broker first
  if (loan.broker_id) {
    const { data: broker } = await adminClient
      .from('brokers').select('id').eq('auth_user_id', userId).maybeSingle()
    if (broker && broker.id === loan.broker_id) {
      return { loanId, borrowerId: loan.borrower_id, brokerId: loan.broker_id, role: 'broker' }
    }
  }
  // Then borrower
  if (loan.borrower_id) {
    const { data: borrower } = await adminClient
      .from('borrowers').select('id').eq('auth_user_id', userId).maybeSingle()
    if (borrower && borrower.id === loan.borrower_id) {
      return { loanId, borrowerId: loan.borrower_id, brokerId: loan.broker_id, role: 'borrower' }
    }
  }
  return null
}
