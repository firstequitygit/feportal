'use client'

// "Conditions List" download control in the Conditions section header.
// A tiny dropdown offering the internal PDF with or without the staff
// notes. Both links hit /api/conditions-report/[id]/pdf (the second
// with ?notes=0).

import { useEffect, useRef, useState } from 'react'
import { Download, ChevronDown } from 'lucide-react'

export function ConditionsListDownload({ loanId }: { loanId: string }) {
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
        className="inline-flex items-center gap-1 text-xs text-primary hover:opacity-80 font-medium"
        title="Download the conditions list (internal PDF)"
      >
        <Download className="w-3.5 h-3.5" />
        Conditions List
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
          <a
            href={`/api/conditions-report/${loanId}/pdf`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            With staff notes
          </a>
          <a
            href={`/api/conditions-report/${loanId}/pdf?notes=0`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Without staff notes
          </a>
        </div>
      )}
    </div>
  )
}
