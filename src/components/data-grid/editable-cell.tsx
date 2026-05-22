'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export type EditableCellType = 'text' | 'email' | 'phone' | 'select'

export interface SelectOption { label: string; value: string }

export interface EditableCellProps {
  value: string | null
  type: EditableCellType
  /** Required for type='select'. */
  options?: SelectOption[]
  /** Placeholder displayed when value is null/empty. */
  placeholder?: string
  /** Display formatter for read state. Defaults to identity. */
  format?: (v: string | null) => string
  /** Async save. Throw or return a non-true value to indicate failure. */
  onSave: (next: string | null) => Promise<true | { error: string }>
  /** Optional: prevents edit (e.g. business rule says this field is locked). */
  readOnly?: boolean
}

export function EditableCell({
  value,
  type,
  options,
  placeholder = '—',
  format,
  onSave,
  readOnly = false,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(value ?? '')
  const [saving, setSaving] = useState(false)
  const [localValue, setLocalValue] = useState<string | null>(value)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  // Sync localValue when the row's source value changes (e.g. parent reload)
  useEffect(() => { setLocalValue(value); setDraft(value ?? '') }, [value])

  // Auto-focus + select on enter
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select()
    }
  }, [editing])

  async function commit() {
    const next = draft.trim() === '' ? null : draft.trim()
    if (next === (localValue ?? null)) { setEditing(false); return }
    setSaving(true)
    setLocalValue(next)        // optimistic
    setEditing(false)
    try {
      const result = await onSave(next)
      if (result !== true) {
        setLocalValue(value)   // revert
        setDraft(value ?? '')
        toast.error(typeof result === 'object' ? result.error : 'Failed to save')
      }
    } catch (e) {
      setLocalValue(value)
      setDraft(value ?? '')
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(localValue ?? '')
    setEditing(false)
  }

  if (readOnly) {
    return (
      <span className="text-sm text-gray-900">
        {format ? format(localValue) : (localValue ?? placeholder)}
      </span>
    )
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-left text-sm text-gray-900 w-full hover:bg-gray-50 px-2 py-1 -mx-2 -my-1 rounded cursor-text"
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      >
        {saving && <span className="text-xs text-gray-400 mr-1">saving…</span>}
        {format ? format(localValue) : (localValue || <span className="text-gray-400">{placeholder}</span>)}
      </button>
    )
  }

  if (type === 'select') {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        className="text-sm border rounded px-1 py-0.5 w-full"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">—</option>
        {(options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type === 'email' ? 'email' : type === 'phone' ? 'tel' : 'text'}
      className="text-sm border rounded px-1 py-0.5 w-full"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
