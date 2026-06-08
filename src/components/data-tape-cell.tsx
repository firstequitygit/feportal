'use client'

// Inline-edit cell used by the Data Tape table. Click → input/select
// appears in place; Enter or blur saves; Escape cancels. Save POSTs
// to /api/loans/field (same endpoint every other in-loan field
// editor uses) so the permission + Pipedrive + Airtable side
// effects all happen automatically.
//
// The parent renders the surrounding <td>; this component just
// returns the inner content (a div-with-text in read mode, an
// <input>/<select> in edit mode) so it slots into the data tape's
// existing column layout without duplicating the sticky / wrap /
// border classes.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export type EditCellFormat =
  | 'text'
  | 'currency'
  | 'integer'
  | 'number'
  | 'percent-stored-as-pct'
  | 'date'
  | 'enum'

interface Props {
  loanId: string
  /** Field key sent to /api/loans/field. Must exist in that route's
   *  FIELD_WHITELIST. */
  field: string
  format: EditCellFormat
  /** Raw underlying value from the data row (number / string / null).
   *  Used to populate the edit input. */
  rawValue: unknown
  /** Pre-formatted display string used in read mode. */
  displayText: string
  /** For format='enum'. */
  enumOptions?: readonly string[]
  /** Tailwind width class — typically the column's widthClass or the
   *  table's default. Drives truncate vs. wrap layout. */
  widthClass: string
  /** Wrap behavior — 'truncate' (collapsed) or 'whitespace-normal
   *  break-words' (row expanded). */
  wrapClass: string
  /** Called after a successful save so the parent can update the
   *  row's local state without a router.refresh(). */
  onSaved: (newRawValue: unknown, newDisplayText: string) => void
}

export function DataTapeCell({
  loanId,
  field,
  format,
  rawValue,
  displayText,
  enumOptions,
  widthClass,
  wrapClass,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)

  function startEdit() {
    if (saving) return
    setDraft(rawToDraft(rawValue, format))
    setEditing(true)
  }

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Highlight existing text on entry so quick replaces don't need
    // a separate select-all step.
    if (el instanceof HTMLInputElement && el.type !== 'date' && el.type !== 'checkbox') {
      el.select()
    }
  }, [editing])

  async function save() {
    if (saving) return
    const parsed = parseDraft(draft, format)
    if (parsed.error) {
      toast.error(parsed.error)
      return
    }
    // Nothing changed → just exit edit mode without a roundtrip.
    if (sameValue(parsed.value, rawValue)) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/loans/field', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, field, value: parsed.value }),
      })
      const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!res.ok || !data?.success) {
        // 403 from the API when this UW isn't assigned to the loan —
        // surface that distinctly so Alicyn knows it's a scope issue,
        // not a bug.
        const msg = data?.error
          ? (res.status === 403 ? `Forbidden — ${data.error}` : data.error)
          : `Save failed (HTTP ${res.status})`
        toast.error(msg)
        setSaving(false)
        return
      }
      onSaved(parsed.value, parsed.display)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setEditing(false)
    setDraft('')
  }

  // ---- Edit mode ----
  if (editing) {
    if (format === 'enum' && enumOptions) {
      return (
        <select
          ref={el => { inputRef.current = el }}
          value={draft}
          onChange={e => {
            // Selects save on change — no need to wait for blur. The
            // <select> closes itself once you pick a value.
            setDraft(e.target.value)
            // Defer save so the state update is visible to save()'s
            // parseDraft.
            setTimeout(() => saveWith(e.target.value), 0)
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          disabled={saving}
          className="w-full text-xs px-1 py-0.5 border border-blue-400 rounded bg-white outline-none"
        >
          <option value="">—</option>
          {enumOptions.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    }

    const inputType =
      format === 'date' ? 'date' :
      format === 'currency' || format === 'integer' || format === 'number' || format === 'percent-stored-as-pct' ? 'number' :
      'text'
    const inputStep =
      format === 'integer' ? '1' :
      format === 'percent-stored-as-pct' ? '0.001' :
      format === 'currency' || format === 'number' ? '0.01' : undefined

    return (
      <input
        ref={el => { inputRef.current = el }}
        type={inputType}
        step={inputStep}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        disabled={saving}
        className="w-full text-xs px-1 py-0.5 border border-blue-400 rounded bg-white outline-none"
      />
    )
  }

  // ---- Read mode ----
  return (
    <button
      type="button"
      onClick={startEdit}
      title="Click to edit"
      className={`text-left w-full hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 rounded-sm transition-colors cursor-text px-0.5 -mx-0.5 ${
        displayText ? 'text-gray-900' : 'text-gray-300'
      }`}
    >
      <div className={`${widthClass} ${wrapClass}`} title={displayText}>
        {displayText || '—'}
      </div>
    </button>
  )

  // Helper used by the enum branch: save with a specific value
  // bypassing the draft-state read race.
  async function saveWith(value: string) {
    if (saving) return
    const parsed = parseDraft(value, format)
    if (parsed.error) { toast.error(parsed.error); return }
    if (sameValue(parsed.value, rawValue)) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await fetch('/api/loans/field', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, field, value: parsed.value }),
      })
      const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!res.ok || !data?.success) {
        const msg = data?.error
          ? (res.status === 403 ? `Forbidden — ${data.error}` : data.error)
          : `Save failed (HTTP ${res.status})`
        toast.error(msg)
        setSaving(false)
        return
      }
      onSaved(parsed.value, parsed.display)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }
}

// ---- Draft / value helpers ----

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const integerFmt = new Intl.NumberFormat('en-US')

function rawToDraft(raw: unknown, format: EditCellFormat): string {
  if (raw === null || raw === undefined) return ''
  if (format === 'date') {
    // The API stores dates as YYYY-MM-DD; the <input type="date">
    // wants the same format.
    return typeof raw === 'string' ? raw.slice(0, 10) : ''
  }
  if (typeof raw === 'number') return String(raw)
  return String(raw)
}

interface ParsedDraft {
  value: string | number | null
  display: string
  error?: string
}

function parseDraft(draft: string, format: EditCellFormat): ParsedDraft {
  const trimmed = draft.trim()
  if (trimmed === '') {
    // Empty input → clear the field. Display goes to '' so the
    // read-mode cell falls back to the '—' placeholder.
    return { value: null, display: '' }
  }
  switch (format) {
    case 'text':
    case 'enum':
      return { value: trimmed, display: trimmed }
    case 'date': {
      // The HTML date input enforces YYYY-MM-DD; pass through.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { value: null, display: '', error: 'Date must be YYYY-MM-DD' }
      }
      return { value: trimmed, display: formatDate(trimmed) }
    }
    case 'integer': {
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return { value: null, display: '', error: 'Must be a number' }
      const i = Math.trunc(n)
      return { value: i, display: integerFmt.format(i) }
    }
    case 'currency': {
      const n = Number(trimmed.replace(/[$,]/g, ''))
      if (!Number.isFinite(n)) return { value: null, display: '', error: 'Must be a dollar amount' }
      return { value: n, display: currencyFmt.format(n) }
    }
    case 'number':
    case 'percent-stored-as-pct': {
      const n = Number(trimmed.replace(/[%,]/g, ''))
      if (!Number.isFinite(n)) return { value: null, display: '', error: 'Must be a number' }
      const display = format === 'percent-stored-as-pct'
        ? (n < 1 ? `${(n * 100).toFixed(3)}%` : `${n.toFixed(n % 1 === 0 ? 0 : 2)}%`)
        : String(n)
      return { value: n, display }
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null && b === '') return true
  if (a === '' && b === null) return true
  if (a === null && b === undefined) return true
  if (a === undefined && b === null) return true
  return false
}

// Local date formatter — mirrors lib/format-date for the cell's
// optimistic display after save. Kept inline to avoid a circular
// dep with the table layer.
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const [, y, mo, d] = m
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${monthNames[Number(mo) - 1]} ${Number(d)}, ${y}`
}
