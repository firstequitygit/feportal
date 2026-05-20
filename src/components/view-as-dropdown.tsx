'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Eye, ChevronDown } from 'lucide-react'

interface Option {
  /** 'borrower' or 'broker' — drives the query-param name */
  kind: 'borrower' | 'broker'
  id: string
  name: string
  /** Optional sub-label, e.g. "Co-borrower 2" or "Slot 2 broker" */
  hint?: string
}

interface Props {
  loanId: string
  options: Option[]
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

  function hrefFor(opt: Option): string {
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
