'use client'

import { useId, useState } from 'react'

export function InfoTooltip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`Why we ask about ${label}`}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500 hover:border-[#1F5D8F] hover:text-[#1F5D8F] transition-colors focus:outline-none focus:ring-2 focus:ring-[#1F5D8F]/30"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-5 top-0 z-10 w-56 rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  )
}
