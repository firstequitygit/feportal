'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, ChevronDown } from 'lucide-react'
import type { ViewAsOption } from '@/lib/view-as-options'

interface Props {
  loanId: string
  options: ViewAsOption[]
}

/**
 * Dropdown shown on admin / LO / LP loan detail pages. Each option opens
 * the borrower or broker view of THIS loan with an impersonation query
 * param. No options → don't render anything.
 *
 * Uses an explicit click-outside listener (vs. onBlur) so picking an item
 * doesn't race with the close animation. Navigation goes through
 * router.push() on mousedown, which fires reliably even when blur tries
 * to tear down the menu underneath.
 */
export function ViewAsDropdown({ loanId, options }: Props) {
  const router = useRouter()
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

  if (options.length === 0) return null

  function hrefFor(opt: ViewAsOption): string {
    if (opt.kind === 'borrower') return `/loans/${loanId}?as_borrower=${opt.id}`
    return `/broker/loans/${loanId}?as_broker=${opt.id}`
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
      >
        <Eye className="w-3.5 h-3.5" />
        View as
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-10">
          {options.map(opt => (
            <button
              key={`${opt.kind}-${opt.id}`}
              type="button"
              // mousedown fires before any blur-driven re-render, so this
              // beats the race even on slower devices.
              onMouseDown={e => {
                e.preventDefault()
                setOpen(false)
                router.push(hrefFor(opt))
              }}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-gray-50 w-full text-left first:rounded-t-md last:rounded-b-md"
            >
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{opt.name}</div>
                {opt.hint && <div className="text-xs text-gray-500">{opt.hint}</div>}
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded ${opt.kind === 'borrower' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>
                {opt.kind === 'borrower' ? 'Borrower' : 'Broker'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
