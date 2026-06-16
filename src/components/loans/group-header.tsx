// src/components/loans/group-header.tsx
'use client'

import { ChevronDown } from 'lucide-react'

/** Compact money for group subtotals: $4.2M / $850K / $500. */
function formatCompactCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K`
  return `$${Math.round(val).toLocaleString('en-US')}`
}

interface Props {
  label: string
  count: number
  /** Optional sum of loan amounts in the group — rendered as a compact
   *  subtotal after the count (e.g. "PROCESSING · 31 · $4.2M"). */
  amount?: number
  collapsed: boolean
  onToggle: () => void
  tone?: 'default' | 'muted' | 'warning'
}

const tones: Record<NonNullable<Props['tone']>, { text: string; rule: string }> = {
  default: { text: 'text-gray-500 hover:text-gray-700', rule: 'bg-gray-200' },
  muted:   { text: 'text-gray-400 hover:text-gray-600', rule: 'bg-gray-200' },
  warning: { text: 'text-amber-700 hover:text-amber-900', rule: 'bg-amber-200' },
}

export function GroupHeader({ label, count, amount, collapsed, onToggle, tone = 'default' }: Props) {
  const t = tones[tone]
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      // Sticky highlighted bar: an elevated white band with border +
      // shadow reads clearly against the gray-50 page as you scroll
      // (plain bg-gray-50 blended in). top-14 sits just below the fixed
      // top nav.
      className="w-full flex items-center gap-3 px-3 py-2 mb-2 group sticky top-14 z-10 bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-sm"
    >
      <ChevronDown
        className={`w-3.5 h-3.5 transition-transform ${t.text} ${collapsed ? '-rotate-90' : ''}`}
      />
      <h3 className={`text-xs font-semibold uppercase tracking-widest whitespace-nowrap transition-colors ${t.text}`}>
        {label} <span className="text-gray-300">·</span> {count}
        {amount !== undefined && (
          <>
            {' '}<span className="text-gray-300">·</span>{' '}
            <span className="tabular-nums tracking-normal">{formatCompactCurrency(amount)}</span>
          </>
        )}
      </h3>
      <div className={`flex-1 h-px ${t.rule}`} />
      <span className={`text-xs whitespace-nowrap transition-colors ${t.text}`}>
        {collapsed ? 'Show' : 'Hide'}
      </span>
    </button>
  )
}
