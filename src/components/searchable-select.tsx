'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, X } from 'lucide-react'

export interface SearchableSelectOption {
  id: string
  /** Primary display text (e.g. "Adam Scovill"). Also matched against the search query. */
  label: string
  /** Optional secondary text rendered below the label (e.g. email + company). Also searchable. */
  sublabel?: string
}

interface Props {
  value: string | null
  options: SearchableSelectOption[]
  onChange: (id: string | null) => void
  placeholder?: string
  /** Label shown when nothing is selected (e.g. "— Unassigned —"). */
  emptyLabel?: string
  disabled?: boolean
}

/**
 * Search-as-you-type select. Replaces native `<select>` when the option
 * list is too long to scroll comfortably (the borrowers list runs into
 * the hundreds). Click-outside closes the popover; ESC also closes.
 *
 * Keyboard:
 *   ArrowDown / ArrowUp — move highlight
 *   Enter               — select highlighted option
 *   Escape              — close
 */
export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = 'Search…',
  emptyLabel = '— None —',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => {
      const haystack = `${o.label} ${o.sublabel ?? ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [options, query])

  // Reset the highlighted row whenever the filtered set changes.
  useEffect(() => { setHighlight(0) }, [query, open])

  // Click-outside closes the popover.
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Auto-focus the search input when the popover opens.
  useEffect(() => {
    if (open) {
      // Slight delay so the input is mounted before we focus.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  function commit(id: string | null) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, filtered.length))   // +1 so the trailing "Unassigned" row is reachable
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // index === filtered.length => the "Unassigned" row at the bottom
      if (highlight === filtered.length) commit(null)
      else if (filtered[highlight]) commit(filtered[highlight].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
    }
  }

  const displayText = selected
    ? selected.label + (selected.sublabel ? ` (${selected.sublabel})` : '')
    : emptyLabel

  return (
    <div ref={rootRef} className="relative">
      {/* The toggle — styled like the native select for visual consistency. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-md px-3 py-2 text-sm text-left bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={`truncate ${selected ? 'text-gray-900' : 'text-gray-500'}`}>
          {displayText}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg max-h-80 overflow-hidden flex flex-col">
          {/* Search input */}
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder={placeholder}
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 pr-7 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); inputRef.current?.focus() }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-4 text-center">No matches</p>
            )}
            {filtered.map((opt, i) => {
              const isSelected = opt.id === value
              const isHighlighted = i === highlight
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => commit(opt.id)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 ${
                    isHighlighted ? 'bg-primary/10' : 'bg-white'
                  } ${isSelected ? 'font-medium text-gray-900' : 'text-gray-700'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="truncate block">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="block text-xs text-gray-500 truncate">{opt.sublabel}</span>
                    )}
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              )
            })}

            {/* Trailing "Unassign" row — always present so the user can clear */}
            <button
              type="button"
              onClick={() => commit(null)}
              onMouseEnter={() => setHighlight(filtered.length)}
              className={`w-full text-left px-3 py-1.5 text-sm border-t border-gray-100 ${
                highlight === filtered.length ? 'bg-primary/10' : 'bg-white'
              } ${value === null ? 'font-medium text-gray-900' : 'text-gray-500'}`}
            >
              {emptyLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
