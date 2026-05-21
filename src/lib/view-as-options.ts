// Pure helper for building the "View as" dropdown options from a loan row.
// Lives outside view-as-dropdown.tsx (which is 'use client') so server
// components can call it without tripping Next.js's client-reference
// machinery. The ViewAsOption type is re-exported here too.

export type ViewAsKind =
  | 'borrower' | 'broker'
  | 'loan_officer' | 'loan_processor' | 'underwriter'

export interface ViewAsOption {
  kind: ViewAsKind
  id: string
  name: string
  /** Optional sub-label, e.g. "Slot 2 broker" or company name */
  hint?: string
}

interface MaybePerson {
  id?: string | null
  full_name?: string | null
  company_name?: string | null
}

/**
 * Pulls borrower + broker (always) and optionally LO/LP/UW (when
 * `includeStaff` is true, i.e. the viewer is an admin) options off a loan
 * row that was queried with the appropriate embeds.
 */
export function buildViewAsOptions(
  loan: {
    borrowers?: MaybePerson | null
    brokers?: MaybePerson | null
    broker_2?: MaybePerson | null
    loan_officers?: MaybePerson | null
    loan_processors?: MaybePerson | null
    loan_processor_2?: MaybePerson | null
    underwriters?: MaybePerson | null
  },
  options: { includeStaff?: boolean } = {},
): ViewAsOption[] {
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

  if (options.includeStaff) {
    if (loan.loan_officers?.id) {
      opts.push({
        kind: 'loan_officer',
        id: loan.loan_officers.id,
        name: loan.loan_officers.full_name ?? '(no name)',
      })
    }
    if (loan.loan_processors?.id) {
      opts.push({
        kind: 'loan_processor',
        id: loan.loan_processors.id,
        name: loan.loan_processors.full_name ?? '(no name)',
      })
    }
    if (loan.loan_processor_2?.id) {
      opts.push({
        kind: 'loan_processor',
        id: loan.loan_processor_2.id,
        name: loan.loan_processor_2.full_name ?? '(no name)',
        hint: 'Slot 2 processor',
      })
    }
    if (loan.underwriters?.id) {
      opts.push({
        kind: 'underwriter',
        id: loan.underwriters.id,
        name: loan.underwriters.full_name ?? '(no name)',
      })
    }
  }

  return opts
}
