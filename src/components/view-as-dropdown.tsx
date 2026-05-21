'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Eye, ChevronDown } from 'lucide-react'

export interface ViewAsOption {
  /** 'borrower' or 'broker' — drives the query-param name */
  kind: 'borrower' | 'broker'
  id: string
  name: string
  /** Optional sub-label, e.g. "Co-borrower 2" or "Slot 2 broker" */
  hint?: string
}

interface Props {
  loanId: string
  options: ViewAsOption[]
}

interface MaybeBorrowerOrBroker { id?: string | null; full_name?: string | null; company_name?: string | null }

/**
 * Shared helper that pulls borrower + broker options off a loan row that
 * was queried with embeds like:
 *   .select('*, borrowers!borrower_id(id, full_name), brokers!broker_id(id, full_name, company_name), broker_2:brokers!broker_id_2(id, full_name, company_name)')
 */
export function buildViewAsOptions(loan: {
  borrowers?: MaybeBorrowerOrBroker | null
  brokers?: MaybeBorrowerOrBroker | null
  broker_2?: MaybeBorrowerOrBroker | null
}): ViewAsOption[] {
  const opts: ViewAsOption[] = []
  if (loan.borrowers?.id) {
    opts.push({ kind: 'borrower', id: loan.borrowers.id, name: loan.borrowers.full_name ?? '(no name)' })
  }
  if (loan.brokers?.id) {
    opts.push({
      kind: 'broker', id: loan.brokers.id,
      name: loan.brokers.full_name ?? '(no name)',
      hint: loan.brokers.company_name ?? undefined,
    })
  }
  if (loan.broker_2?.id) {
    opts.push({
      kind: 'broker', id: loan.broker_2.id,
      name: loan.broker_2.full_name ?? '(no name)',
      hint: loan.broker_2.company_name ?? 'Slot 2 broker',
    })
  }
  return opts
}

/**
 * Admin-only dropdown shown on the admin loan detail page.  Each option
 * opens the borrower or broker view of THIS loan with an impersonation
 * query param.  No options → don't render anything (loan has no borrower
 * or broker assigned).
 */
export function ViewAsDropdown({ loanId, options }: Props) {
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null

  function hrefFor(opt: ViewAsOption): string {
    if (opt.kind === 'borrower') return `/loans/${loanId}?as_borrower=${opt.id}`
    return `/broker/loans/${loanId}?as_broker=${opt.id}`
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
      >
        <Eye className="w-3.5 h-3.5" />
        View as
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-10">
          {options.map(opt => (
            <Link
              key={`${opt.kind}-${opt.id}`}
              href={hrefFor(opt)}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-gray-50"
            >
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{opt.name}</div>
                {opt.hint && <div className="text-xs text-gray-500">{opt.hint}</div>}
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded ${opt.kind === 'borrower' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>
                {opt.kind === 'borrower' ? 'Borrower' : 'Broker'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
