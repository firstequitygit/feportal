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
        className="ml-1.5 inline-flex h-[14px] w-[14px] items-center justify-center rounded-full border border-(--apply-ink-muted,#94a3b8)/40 text-[9px] italic text-(--apply-ink-muted,#64748b) hover:border-(--apply-brand,#1F5D8F) hover:text-(--apply-brand,#1F5D8F) transition-colors focus:outline-none focus:ring-1 focus:ring-(--apply-brand,#1F5D8F)/40"
        style={{ fontFamily: "var(--font-display, Georgia, serif)" }}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-5 top-0 z-10 w-56 rounded-sm border border-(--apply-border,#E2E8F0) bg-(--apply-surface,#ffffff) p-3 text-xs text-(--apply-ink-subtle,#475569) shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  )
}
