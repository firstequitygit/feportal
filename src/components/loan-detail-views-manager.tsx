'use client'

// Manage-views modal — opened from the picker inside the Loan Details
// card header. Left column lists the user's saved views; right column
// edits the selected view (name, default, and the per-field checkbox
// grid grouped by section).
//
// Editing is auto-saved on blur (name) and on every toggle (default,
// field checkboxes). The parent LoanDetailsCard owns the active view
// state and re-fetches /api/loan-detail-views after any change so a
// fresh GET drives the in-place list update.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Trash2, Plus, X, Star } from 'lucide-react'
import {
  LOAN_DETAILS_FIELDS,
  loanDetailsFieldsBySection,
  type LoanDetailsFieldDef,
} from '@/lib/loan-details-fields'

export interface LoanDetailView {
  id: string
  name: string
  hidden_fields: string[]
  is_default: boolean
  created_at: string
  updated_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  views: LoanDetailView[]
  /** Reload triggered after every CRUD action so the parent picker
   *  and the modal stay in sync. */
  onChanged: () => Promise<void> | void
  /** The view selected when the modal opens — defaults to the
   *  active view from the parent, falls back to the first view, or
   *  null when the user has none yet. */
  initialSelectedId: string | null
}

const ALL_FIELDS_BY_SECTION = loanDetailsFieldsBySection()
const ALL_FIELD_COUNT = LOAN_DETAILS_FIELDS.length

export function LoanDetailViewsManager({
  open,
  onClose,
  views,
  onChanged,
  initialSelectedId,
}: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // Sync the local "selected" pointer with the prop whenever the
  // modal reopens or the parent's views list changes. Without this
  // the modal can hold a stale id pointing at a just-deleted view.
  useEffect(() => {
    if (!open) return
    if (selectedId && views.some(v => v.id === selectedId)) return
    setSelectedId(initialSelectedId ?? views[0]?.id ?? null)
  }, [open, views, initialSelectedId, selectedId])

  // Close on Escape, mirror the popover patterns elsewhere.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !mounted) return null

  const selected = views.find(v => v.id === selectedId) ?? null

  async function createView() {
    const name = newName.trim()
    if (!name) return
    const res = await fetch('/api/loan-detail-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hiddenFields: [], isDefault: views.length === 0 }),
    })
    const data = await res.json().catch(() => null) as { view?: LoanDetailView; error?: string } | null
    if (!res.ok || !data?.view) {
      toast.error(data?.error ?? `Could not create view (HTTP ${res.status})`)
      return
    }
    setSelectedId(data.view.id)
    setNewName('')
    setCreating(false)
    await onChanged()
    toast.success(`Created "${data.view.name}"`)
  }

  async function deleteView(view: LoanDetailView) {
    if (!confirm(`Delete "${view.name}"? Other staff aren't affected.`)) return
    const res = await fetch(`/api/loan-detail-views/${view.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
    if (!res.ok || !data?.success) {
      toast.error(data?.error ?? `Could not delete (HTTP ${res.status})`)
      return
    }
    if (selectedId === view.id) setSelectedId(null)
    await onChanged()
    toast.success(`Deleted "${view.name}"`)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Manage Loan Details Views</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 -m-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar: list of saved views + create */}
          <div className="w-56 border-r border-gray-200 bg-gray-50 flex flex-col">
            <div className="flex-1 overflow-y-auto">
              {views.length === 0 && !creating && (
                <p className="text-xs text-gray-500 italic px-3 py-3">
                  No views yet. Create one to start hiding fields.
                </p>
              )}
              {views.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left px-3 py-2 text-sm border-l-2 ${
                    selectedId === v.id
                      ? 'border-primary bg-white font-medium text-gray-900'
                      : 'border-transparent text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{v.name}</span>
                    {v.is_default && (
                      <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {v.hidden_fields.length === 0
                      ? 'All fields visible'
                      : `Hides ${v.hidden_fields.length} field${v.hidden_fields.length === 1 ? '' : 's'}`}
                  </div>
                </button>
              ))}
            </div>
            <div className="border-t border-gray-200 p-2">
              {creating ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="View name"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') createView()
                      if (e.key === 'Escape') { setCreating(false); setNewName('') }
                    }}
                    className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={createView}
                      disabled={!newName.trim()}
                      className="flex-1 text-xs bg-primary text-white px-2 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreating(false); setNewName('') }}
                      className="text-xs text-gray-500 px-2 py-1.5 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-primary hover:opacity-80 px-2 py-1.5 rounded border border-dashed border-gray-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New view
                </button>
              )}
            </div>
          </div>

          {/* Right pane: editor for the selected view */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <ViewEditor
                key={selected.id}
                view={selected}
                onChanged={onChanged}
                onDelete={() => deleteView(selected)}
              />
            ) : (
              <div className="p-8 text-center text-sm text-gray-500">
                Pick a view on the left, or create a new one.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

interface EditorProps {
  view: LoanDetailView
  onChanged: () => Promise<void> | void
  onDelete: () => void
}

function ViewEditor({ view, onChanged, onDelete }: EditorProps) {
  // Local state for the name + hidden fields — typed/clicked changes
  // apply immediately to the UI, then PATCH propagates them. We
  // don't optimistic-rollback on error; just toast and let the user
  // retry. The parent re-fetches after every save so anything that
  // does fail re-syncs on the next round trip.
  const [name, setName] = useState(view.name)
  const [hidden, setHidden] = useState<Set<string>>(new Set(view.hidden_fields))
  const [savingName, setSavingName] = useState(false)
  const nameRef = useRef(name)
  nameRef.current = name

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch(`/api/loan-detail-views/${view.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null) as { view?: LoanDetailView; error?: string } | null
    if (!res.ok) {
      toast.error(data?.error ?? `Save failed (HTTP ${res.status})`)
      return null
    }
    await onChanged()
    return data?.view ?? null
  }

  async function saveName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === view.name) return
    setSavingName(true)
    await patch({ name: trimmed })
    setSavingName(false)
  }

  async function toggleField(key: string) {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setHidden(next)
    await patch({ hiddenFields: Array.from(next) })
  }

  async function setAllInSection(sectionFields: LoanDetailsFieldDef[], hide: boolean) {
    const next = new Set(hidden)
    for (const f of sectionFields) {
      if (hide) next.add(f.key)
      else next.delete(f.key)
    }
    setHidden(next)
    await patch({ hiddenFields: Array.from(next) })
  }

  async function setAll(hide: boolean) {
    const next = new Set<string>()
    if (hide) {
      for (const f of LOAN_DETAILS_FIELDS) next.add(f.key)
    }
    setHidden(next)
    await patch({ hiddenFields: Array.from(next) })
  }

  async function toggleDefault() {
    await patch({ isDefault: !view.is_default })
  }

  const hiddenCount = hidden.size
  const visibleCount = ALL_FIELD_COUNT - hiddenCount

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-gray-200 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="flex-1 text-base font-semibold text-gray-900 px-2 py-1 border border-transparent hover:border-gray-200 focus:border-gray-300 focus:outline-none rounded"
            disabled={savingName}
          />
          <button
            type="button"
            onClick={toggleDefault}
            title={view.is_default ? 'Currently your default view' : 'Set as default view'}
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${
              view.is_default
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Star className={`w-3 h-3 ${view.is_default ? 'fill-amber-500 text-amber-500' : ''}`} />
            {view.is_default ? 'Default' : 'Make default'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete view"
            className="text-gray-400 hover:text-red-600 p-1.5 rounded border border-transparent hover:border-red-200"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
          <span>
            <strong className="text-gray-700">{visibleCount}</strong> visible
            <span className="mx-1.5">·</span>
            <strong className="text-gray-700">{hiddenCount}</strong> hidden
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAll(false)}
              className="text-xs text-primary hover:opacity-80 font-medium px-2 py-1"
            >
              Show all
            </button>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="text-xs text-primary hover:opacity-80 font-medium px-2 py-1"
            >
              Hide all
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
        {ALL_FIELDS_BY_SECTION.map(({ section, fields }) => {
          const sectionHiddenCount = fields.filter(f => hidden.has(f.key)).length
          const allHidden = sectionHiddenCount === fields.length
          return (
            <div key={section} className="border border-gray-200 rounded-md">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  {section}
                </span>
                <button
                  type="button"
                  onClick={() => setAllInSection(fields, !allHidden)}
                  className="text-xs text-primary hover:opacity-80 font-medium"
                >
                  {allHidden ? 'Show all' : 'Hide all'}
                </button>
              </div>
              <div className="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {fields.map(f => {
                  const isHidden = hidden.has(f.key)
                  return (
                    <label
                      key={f.key}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1.5 py-1 -mx-1.5 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleField(f.key)}
                        className="h-3.5 w-3.5"
                      />
                      <span className={isHidden ? 'text-gray-400 line-through' : 'text-gray-700'}>
                        {f.label}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
