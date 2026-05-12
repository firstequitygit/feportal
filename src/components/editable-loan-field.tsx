'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type EditableFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'enum'
  | 'boolean'

interface Props {
  loanId: string
  field: string
  type: EditableFieldType
  /** The raw value from the DB. Boolean for type='boolean', else string|number|null. */
  currentValue: string | number | boolean | null
  /** What to render when not editing — usually a formatted version of currentValue.
   *  Not required for boolean (renders its own toggle). */
  display?: React.ReactNode
  /** For type='enum' */
  options?: readonly string[]
  /** Optional placeholder for the input */
  placeholder?: string
  /** Optional input width override (Tailwind class), default "w-32".
   *  Textareas default to "w-full". */
  inputWidthClass?: string
  /** Decimal precision for number/currency/percent inputs (default 'any') */
  step?: string | number
  /** Rows for textarea (default 3) */
  rows?: number
  /** Override the API endpoint (default '/api/loans/field'). Used by the
   *  borrower address card to write to '/api/borrowers/field'. */
  apiEndpoint?: string
}

export function EditableLoanField({
  loanId,
  field,
  type,
  currentValue,
  display,
  options,
  placeholder,
  inputWidthClass,
  step = 'any',
  rows = 3,
  apiEndpoint = '/api/loans/field',
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<string>(
    currentValue === null || currentValue === undefined ? '' : String(currentValue),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setValue(currentValue === null || currentValue === undefined ? '' : String(currentValue))
    setError(null)
  }

  function handleCancel() {
    reset()
    setEditing(false)
  }

  async function save(payload: string | number | boolean | null) {
    const res = await fetch(apiEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, field, value: payload }),
    })
    const data = await res.json().catch(() => ({}))
    return data as { success?: boolean; error?: string }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    let payload: string | number | null = null
    const trimmed = value.trim()
    if (trimmed === '') {
      payload = null
    } else if (type === 'number' || type === 'currency' || type === 'percent') {
      const n = Number(trimmed)
      if (isNaN(n)) {
        setError('Invalid number')
        setSaving(false)
        return
      }
      payload = n
    } else {
      payload = trimmed
    }

    const data = await save(payload)
    if (data.success) {
      setEditing(false)
      router.refresh()
    } else {
      setError(data.error ?? 'Could not save')
    }
    setSaving(false)
  }

  // ===== Boolean: render an inline checkbox that saves on toggle =====
  if (type === 'boolean') {
    const checked = currentValue === true
    async function toggle() {
      setSaving(true)
      setError(null)
      const data = await save(!checked)
      if (data.success) router.refresh()
      else setError(data.error ?? 'Could not save')
      setSaving(false)
    }
    return (
      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          disabled={saving}
          onChange={toggle}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
        <span className="text-xs text-gray-500">{checked ? 'Yes' : 'No'}</span>
        {error && <span className="text-xs text-red-600 ml-1">{error}</span>}
      </label>
    )
  }

  // ===== Textarea: full-width edit-in-place =====
  if (editing && type === 'textarea') {
    return (
      <div className="flex flex-col gap-2 w-full">
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          autoFocus
          className="text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:border-primary w-full resize-y"
        />
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs text-white bg-primary hover:opacity-90 disabled:opacity-50 px-2 py-1 rounded font-medium"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-600 text-right">{error}</p>}
      </div>
    )
  }

  if (editing) {
    const widthClass = inputWidthClass ?? 'w-32'
    const inputBase = `text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:border-primary ${widthClass}`
    return (
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {type === 'enum' && options ? (
          <select
            value={value}
            onChange={e => setValue(e.target.value)}
            className={inputBase}
            autoFocus
          >
            <option value="">—</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : type === 'date' ? (
          <input
            type="date"
            value={value.split('T')[0] /* strip time if present */}
            onChange={e => setValue(e.target.value)}
            className={inputBase}
            autoFocus
          />
        ) : (
          <input
            type={type === 'number' || type === 'currency' || type === 'percent' ? 'number' : 'text'}
            step={type === 'number' || type === 'currency' || type === 'percent' ? step : undefined}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder}
            className={inputBase}
            autoFocus
          />
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs text-white bg-primary hover:opacity-90 disabled:opacity-50 px-2 py-1 rounded font-medium"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          disabled={saving}
          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <p className="text-xs text-red-600 w-full text-right">{error}</p>}
      </div>
    )
  }

  // ===== Display (not editing) =====
  if (type === 'textarea') {
    // Textarea display is multi-line; clicking the value enters edit mode.
    const text = (typeof currentValue === 'string' && currentValue.trim()) || ''
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-left w-full text-gray-900 hover:text-primary transition-colors"
        title="Click to edit"
      >
        {text ? (
          <span className="block whitespace-pre-wrap font-medium">{text}</span>
        ) : (
          <span className="block text-gray-400 italic">— click to add</span>
        )}
        <span className="text-xs text-gray-400 mt-0.5 inline-block">edit</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="font-medium text-gray-900 hover:text-primary transition-colors text-left"
      title="Click to edit"
    >
      {display}
      <span className="text-xs text-gray-400 ml-1.5">edit</span>
    </button>
  )
}
