// Pure helper for building the "View as" dropdown options from a loan row.
// Lives outside view-as-dropdown.tsx (which is 'use client') so server
// components can call it without tripping Next.js's client-reference
// machinery. The ViewAsOption type is re-exported here too.

export interface ViewAsOption {
  /** 'borrower' or 'broker' — drives the query-param name */
  kind: 'borrower' | 'broker'
  id: string
  name: string
  /** Optional sub-label, e.g. "Slot 2 broker" */
  hint?: string
}

interface MaybeBorrowerOrBroker {
  id?: string | null
  full_name?: string | null
  company_name?: string | null
}

/**
 * Pulls borrower + broker options off a loan row that was queried with
 * embeds like:
 *   .select('*, borrowers!borrower_id(id, full_name), brokers!broker_id(id, full_name, company_name), broker_2:brokers!broker_id_2(id, full_name, company_name)')
 */
export function buildViewAsOptions(loan: {
  borrowers?: MaybeBorrowerOrBroker | null
  brokers?: MaybeBorrowerOrBroker | null
  broker_2?: MaybeBorrowerOrBroker | null
}): ViewAsOption[] {
  const opts: ViewAsOption[] = []
  if (loan.borrowers?.id) {
    opts.push({
      kind: 'borrower',
      id: loan.borrowers.id,
      name: loan.borrowers.full_name ?? '(no name)',
    })
  }
  if (loan.brokers?.id) {
    opts.push({
      kind: 'broker',
      id: loan.brokers.id,
      name: loan.brokers.full_name ?? '(no name)',
      hint: loan.brokers.company_name ?? undefined,
    })
  }
  if (loan.broker_2?.id) {
    opts.push({
      kind: 'broker',
      id: loan.broker_2.id,
      name: loan.broker_2.full_name ?? '(no name)',
      hint: loan.broker_2.company_name ?? 'Slot 2 broker',
    })
  }
  return opts
}
