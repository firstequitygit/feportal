'use client'

// Clickable assignee badge used inside the "Add from Templates" lists
// in admin / LP / UW conditions managers. The badge looks like the
// existing role pill, but clicking it opens a small popover with the
// five role options so the staff can override the template's default
// assignee before adding the condition.
//
// Stateful at the parent level: the parent owns the `value` and
// passes `onChange`. That way bulk-add reads from the parent's
// override map and an unchanged badge still uses the template's
// default.
//
// The popover is rendered via React portal to document.body and
// positioned using getBoundingClientRect on the trigger. We can't
// use a simple absolute child div because each template row sits
// inside a card with `overflow-hidden` (for the rounded corners),
// which would clip the dropdown behind the next card below.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { AssignedTo } from '@/lib/types'

const OPTIONS: AssignedTo[] = ['borrower', 'loan_officer', 'loan_processor', 'underwriter', 'closer']

function colorFor(a: AssignedTo): string {
  switch (a) {
    case 'loan_officer':   return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'loan_processor': return 'bg-purple-100 text-purple-700 border-purple-200'
    case 'underwriter':    return 'bg-rose-100 text-rose-700 border-rose-200'
    case 'closer':         return 'bg-amber-100 text-amber-700 border-amber-200'
    default:               return 'bg-gray-100 text-gray-600 border-gray-200'
  }
}

function labelFor(a: AssignedTo): string {
  switch (a) {
    case 'loan_officer':   return 'Loan Officer'
    case 'loan_processor': return 'Loan Processor'
    case 'underwriter':    return 'Underwriter'
    case 'closer':         return 'Closer'
    default:               return 'Borrower'
  }
}

interface Props {
  value: AssignedTo
  onChange: (next: AssignedTo) => void
  /** When true, render as plain text (no popover). Used during the
   *  brief saving window so the user can't change mid-request. */
  disabled?: boolean
}

export function TemplateAssigneePicker({ value, onChange, disabled = false }: Props) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { setMounted(true) }, [])

  function recomputeAnchor() {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Position the popover just below the trigger, left-aligned.
    // Coordinates are viewport-relative because the portal uses
    // position: fixed.
    setAnchor({
      top: rect.bottom + 4,
      left: rect.left,
    })
  }

  useEffect(() => {
    if (!open) return
    function reposition() { recomputeAnchor() }
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={disabled ? undefined : (e) => {
          e.stopPropagation()
          if (!open) recomputeAnchor()
          setOpen(o => !o)
        }}
        disabled={disabled}
        title="Click to change assignee for this template"
        className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border ${colorFor(value)} ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:opacity-80'}`}
      >
        {labelFor(value)}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && mounted && anchor && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: anchor.top, left: anchor.left }}
          className="z-50 w-40 bg-white border border-gray-200 rounded-md shadow-lg py-1"
          onClick={e => e.stopPropagation()}
        >
          {OPTIONS.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(opt); setOpen(false) }}
              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${opt === value ? 'font-semibold' : ''}`}
            >
              {labelFor(opt)}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
