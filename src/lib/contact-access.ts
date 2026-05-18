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

  // Pull the loan first so we have all borrower / broker slots
  const { data: loan } = await adminClient
    .from('loans')
    .select('id, borrower_id, borrower_id_2, borrower_id_3, borrower_id_4, broker_id, broker_id_2')
    .eq('id', loanId)
    .maybeSingle()
  if (!loan) return null

  // Try broker first — either slot counts as broker access
  const brokerSlots = [loan.broker_id, loan.broker_id_2].filter((x): x is string => !!x)
  if (brokerSlots.length > 0) {
    const { data: broker } = await adminClient
      .from('brokers').select('id').eq('auth_user_id', userId).maybeSingle()
    if (broker && brokerSlots.includes(broker.id)) {
      // brokerId returned is whichever slot matched this user
      return { loanId, borrowerId: loan.borrower_id, brokerId: broker.id, role: 'broker' }
    }
  }
  // Then any of the four borrower slots
  const borrowerSlots = [loan.borrower_id, loan.borrower_id_2, loan.borrower_id_3, loan.borrower_id_4]
    .filter((x): x is string => !!x)
  if (borrowerSlots.length > 0) {
    const { data: borrower } = await adminClient
      .from('borrowers').select('id').eq('auth_user_id', userId).maybeSingle()
    if (borrower && borrowerSlots.includes(borrower.id)) {
      // borrowerId returned is the matching slot's borrower (which IS the user)
      return { loanId, borrowerId: borrower.id, brokerId: loan.broker_id, role: 'borrower' }
    }
  }
  return null
}
