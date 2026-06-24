'use client'

// "Generate Loan Docs" dropdown in the loan detail header. Replaces
// the old single "Generate Approval Letter" link — that link is now
// one of the options inside this menu, keeping the header tidy as
// we add Committee Review / Term Sheet / Attorney Submission.
//
// Auto-picks DSCR vs Fix&Flip variants downstream — those pages
// route based on loan_type, so the menu just links the user
// straight there.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { FileText, ChevronDown } from 'lucide-react'

interface Props {
  loanId: string
}

export function LoanDocGeneratorMenu({ loanId }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        // Same pill / h-7 / text-xs styling as the rest of the
        // loan header action row.
        className="inline-flex items-center gap-1.5 h-7 px-3.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 whitespace-nowrap"
      >
        <FileText className="w-3.5 h-3.5" />
        Generate Loan Docs
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1">
          <MenuLink href={`/approval-letter/${loanId}`} label="Conditional Approval Letter" />
          <div className="border-t border-gray-100 my-1" />
          <MenuLink href={`/committee-review/${loanId}`} label="Committee Review Sheet" />
          <MenuLink href={`/term-sheet/${loanId}`} label="Loan Term Sheet" />
          <MenuLink href={`/attorney-summary/${loanId}`} label="Attorney Submission Summary" />
        </div>
      )}
    </div>
  )
}

function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
      // Open in new tab so the user keeps the loan page handy
      // while reviewing / printing the doc.
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </Link>
  )
}
