'use client'

// Reusable textarea with @mention autocomplete.
//
// Usage: parent passes the staff directory + value + onChange. When the
// user types '@', a small popup shows matching staff. Picking one
// inserts "@FirstLast" into the text AND adds {kind, id, full_name} to
// the parent's mentions array. The parent forwards that array to the
// backend alongside the text so the server doesn't have to parse @tokens
// at all (no typo / spoofing risk).
//
// Notes on UX choices:
// - Token format is camelCase no-spaces (e.g. "@AdamScovill") because
//   that matches the user's mental model from Slack / GitHub. If a
//   typed token doesn't match anything in the directory it's just
//   plain text — no silent fail.
// - The dropdown closes on space, enter, escape, or click outside.
// - Manually editing an already-inserted @token doesn't remove it from
//   the mentions array. That's an intentional simplification — we'd
//   rather over-notify than silently miss a mention.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MentionableUser } from '@/lib/mentionable-staff'

export interface MentionRef {
  kind: MentionableUser['kind']
  id: string
  full_name: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Add or remove from the parent's mentions array. */
  mentions: MentionRef[]
  onMentionsChange: (mentions: MentionRef[]) => void
  /** Pre-fetched directory. Server-rendered pages pass this down. */
  directory: MentionableUser[]
  placeholder?: string
  rows?: number
  disabled?: boolean
  className?: string
  /** "Read-only preview" warning when impersonating. */
  title?: string
}

export function MentionTextarea({
  value,
  onChange,
  mentions,
  onMentionsChange,
  directory,
  placeholder,
  rows = 3,
  disabled,
  className,
  title,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  // queryStart is the index of the '@' character that opened the popup.
  // We use it both to filter (query = value.slice(start + 1, caret)) and
  // to replace the right slice on selection.
  const [queryStart, setQueryStart] = useState<number | null>(null)
  const [highlight, setHighlight] = useState(0)

  // Filter the directory based on what's typed AFTER the '@'.
  const query = useMemo(() => {
    if (queryStart === null) return ''
    const ta = textareaRef.current
    if (!ta) return ''
    const caret = ta.selectionStart ?? 0
    if (caret <= queryStart) return ''
    return value.slice(queryStart + 1, caret)
  }, [queryStart, value])

  const matches = useMemo(() => {
    if (!dropdownOpen) return []
    const q = query.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!q) return directory.slice(0, 8)
    return directory
      .filter(u => u.token.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8)
  }, [dropdownOpen, query, directory])

  // Reset highlight when filter changes.
  useEffect(() => { setHighlight(0) }, [matches.length, query])

  function closeDropdown() {
    setDropdownOpen(false)
    setQueryStart(null)
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    onChange(next)

    // If the popup is open, check whether the caret is still in the
    // current @-query region. If not (space typed, caret moved before
    // the @), close it.
    if (queryStart !== null) {
      const caret = e.target.selectionStart ?? 0
      if (caret <= queryStart) { closeDropdown(); return }
      const region = next.slice(queryStart, caret)
      if (/\s/.test(region) || !region.startsWith('@')) closeDropdown()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (dropdownOpen && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight(h => (h + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight(h => (h - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMatch(matches[highlight])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDropdown()
        return
      }
    }

    if (e.key === '@') {
      // Defer to AFTER the keystroke so the textarea state has the new
      // '@' character + correct caret position.
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        setQueryStart(ta.selectionStart - 1)
        setDropdownOpen(true)
        setHighlight(0)
      })
    }
  }

  function selectMatch(user: MentionableUser) {
    const ta = textareaRef.current
    if (!ta || queryStart === null) return
    const caret = ta.selectionStart ?? 0
    const before = value.slice(0, queryStart)
    const after = value.slice(caret)
    const inserted = `@${user.token} `  // trailing space so the user can keep typing
    const nextValue = before + inserted + after
    onChange(nextValue)

    // Add to mentions array if not already there.
    if (!mentions.some(m => m.kind === user.kind && m.id === user.id)) {
      onMentionsChange([...mentions, { kind: user.kind, id: user.id, full_name: user.full_name }])
    }

    closeDropdown()

    // Restore caret position to right after the inserted token + space.
    requestAnimationFrame(() => {
      const next = ta
      const pos = before.length + inserted.length
      next.focus()
      next.setSelectionRange(pos, pos)
    })
  }

  // Close on click outside.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!dropdownOpen) return
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) closeDropdown()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [dropdownOpen])

  return (
    <div ref={wrapperRef} className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        title={title}
        className={className ?? 'w-full text-sm border border-gray-300 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent'}
      />
      {dropdownOpen && matches.length > 0 && (
        <div className="absolute z-20 mt-1 left-0 w-72 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {matches.map((u, idx) => (
            <button
              type="button"
              key={`${u.kind}-${u.id}`}
              onMouseDown={e => { e.preventDefault(); selectMatch(u) }}
              onMouseEnter={() => setHighlight(idx)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 ${idx === highlight ? 'bg-primary/5' : 'hover:bg-gray-50'}`}
            >
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{u.full_name}</div>
                <div className="text-xs text-gray-500">@{u.token}</div>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-gray-400 whitespace-nowrap">
                {kindLabel(u.kind)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function kindLabel(k: MentionableUser['kind']): string {
  switch (k) {
    case 'admin':          return 'Admin'
    case 'loan_officer':   return 'LO'
    case 'loan_processor': return 'LP'
    case 'underwriter':    return 'UW'
  }
}
