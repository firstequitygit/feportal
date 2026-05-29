'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import type { Condition, ConditionCategory } from '@/lib/types'
import { CONDITION_CATEGORIES } from '@/lib/types'

export type BulkDoc = {
  id: string
  file_name: string
  file_path: string
  file_size: number | null
  suggested_condition_id: string | null
  /** UI-only: which condition the user has confirmed (null = staying unmatched). */
  staged_condition_id: string | null
  /** UI-only: has the user explicitly confirmed (vs. raw suggestion)? */
  confirmed: boolean
}

type Props = {
  loanId: string
  conditions: Condition[]
  open: boolean
  onClose: () => void
  /** When provided, modal opens directly in matcher mode with these docs. */
  initialDocs?: BulkDoc[]
  /** Called after a successful save so the parent can refresh data. */
  onSaved?: () => void
}

export function BulkUploadModal({ loanId, conditions, open, onClose, initialDocs, onSaved }: Props) {
  const [phase, setPhase] = useState<'drop' | 'match'>(initialDocs && initialDocs.length > 0 ? 'match' : 'drop')
  const [docs, setDocs] = useState<BulkDoc[]>(initialDocs ?? [])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPhase(initialDocs && initialDocs.length > 0 ? 'match' : 'drop')
    setDocs(initialDocs ?? [])
    setUploadError(null)
    setSaveError(null)
  }, [open, initialDocs])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <header className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {phase === 'drop' ? 'Bulk upload documents' : 'Match documents to conditions'}
          </h2>
          <button
            onClick={() => { if (!uploading) onClose() }}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close"
            disabled={uploading}
          >
            X
          </button>
        </header>
        {phase === 'drop'
          ? <DropPhase
              loanId={loanId}
              uploading={uploading}
              setUploading={setUploading}
              error={uploadError}
              setError={setUploadError}
              onUploaded={uploaded => { setDocs(uploaded); setPhase('match') }}
            />
          : <MatchPhase
              docs={docs}
              setDocs={setDocs}
              conditions={conditions}
              saving={saving}
              error={saveError}
              onCancel={onClose}
              onSave={async () => {
                setSaving(true); setSaveError(null)
                const toCommit = docs.filter(d => d.confirmed)
                const results = await Promise.all(toCommit.map(d =>
                  fetch(`/api/documents/${d.id}/match`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ condition_id: d.staged_condition_id }),
                  }).then(r => r.json()).catch(() => ({ success: false }))
                ))
                const failed = results.filter(r => !r.success).length
                setSaving(false)
                if (failed > 0) {
                  setSaveError(`${failed} of ${toCommit.length} matches failed`)
                  return
                }
                onSaved?.()
                onClose()
              }}
            />
        }
      </div>
    </div>
  )
}

function DropPhase({
  loanId, uploading, setUploading, error, setError, onUploaded,
}: {
  loanId: string
  uploading: boolean
  setUploading: (v: boolean) => void
  error: string | null
  setError: (e: string | null) => void
  onUploaded: (docs: BulkDoc[]) => void
}) {
  const [dragging, setDragging] = useState(false)

  async function handleFiles(files: File[]) {
    if (files.length === 0) return
    setUploading(true); setError(null)
    try {
      const signRes = await fetch('/api/documents/bulk-upload/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, fileNames: files.map(f => f.name) }),
      })
      const signData = await signRes.json()
      if (!signRes.ok) { setError(signData.error ?? 'Could not start upload'); setUploading(false); return }
      const supabase = createClient()

      const uploaded: { fileName: string; fileSize: number; path: string }[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const upload = signData.uploads[i]
        const { error: upErr } = await supabase.storage.from('documents').uploadToSignedUrl(
          upload.path, upload.token, file,
          { contentType: file.type || 'application/octet-stream' },
        )
        if (upErr) { setError(`"${file.name}" upload failed: ${upErr.message}`); setUploading(false); return }
        uploaded.push({ fileName: file.name, fileSize: file.size, path: upload.path })
      }

      const recRes = await fetch('/api/documents/bulk-upload/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, files: uploaded }),
      })
      const recData = await recRes.json()
      if (!recRes.ok) { setError(recData.error ?? 'Could not save documents'); setUploading(false); return }

      type RecordedDoc = {
        id: string
        file_name: string
        file_path: string
        file_size: number | null
        suggested_condition_id: string | null
      }
      const docs: BulkDoc[] = recData.documents.map((d: RecordedDoc) => ({
        id: d.id,
        file_name: d.file_name,
        file_path: d.file_path,
        file_size: d.file_size,
        suggested_condition_id: d.suggested_condition_id,
        staged_condition_id: d.suggested_condition_id,
        confirmed: false,
      }))
      setUploading(false)
      onUploaded(docs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setUploading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col p-6">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false)
          handleFiles(Array.from(e.dataTransfer.files))
        }}
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-gray-300'}`}
      >
        <p className="text-gray-700 mb-2">{uploading ? 'Uploading...' : 'Drop files here'}</p>
        <p className="text-sm text-gray-500 mb-4">or</p>
        <label className="inline-block">
          <input
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={e => handleFiles(Array.from(e.target.files ?? []))}
          />
          <span className="inline-block px-4 py-2 rounded bg-primary text-white cursor-pointer hover:bg-primary/90">
            Browse files
          </span>
        </label>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
      <p className="mt-3 text-xs text-gray-500 text-center">
        Files are saved immediately. You can close this window and finish matching later from the Unmatched documents card.
      </p>
    </div>
  )
}

function MatchPhase({
  docs, setDocs, conditions, saving, error, onCancel, onSave,
}: {
  docs: BulkDoc[]
  setDocs: (updater: (prev: BulkDoc[]) => BulkDoc[]) => void
  conditions: Condition[]
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: () => void
}) {
  const grouped = useMemo(() => {
    const g: Record<ConditionCategory | 'uncategorized', Condition[]> = {
      initial: [], underwriting: [], pre_close: [], pre_funding: [], uncategorized: [],
    }
    for (const c of conditions) {
      const key = (c.category ?? 'uncategorized') as keyof typeof g
      g[key].push(c)
    }
    return g
  }, [conditions])

  const conditionById = useMemo(() => new Map(conditions.map(c => [c.id, c])), [conditions])

  function stageOnCondition(docId: string, conditionId: string | null) {
    setDocs(prev => prev.map(d =>
      d.id === docId
        ? { ...d, staged_condition_id: conditionId, confirmed: conditionId !== null }
        : d
    ))
  }

  function confirmedCount(): number {
    return docs.filter(d => d.confirmed).length
  }

  return (
    <>
      <div className="flex-1 grid grid-cols-2 gap-4 p-6 overflow-hidden">
        <section className="flex flex-col overflow-hidden">
          <h3 className="text-sm font-semibold mb-2">Files to match ({docs.length})</h3>
          <ul className="flex-1 overflow-y-auto space-y-2 pr-2">
            {docs.map(d => {
              const matched = d.staged_condition_id ? conditionById.get(d.staged_condition_id) : null
              const pillClass = d.confirmed
                ? 'bg-green-100 text-green-800'
                : d.staged_condition_id
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-gray-100 text-gray-700'
              const pillText = d.confirmed
                ? `Confirmed: ${matched?.title ?? '...'}`
                : d.staged_condition_id
                  ? `Auto-matched: ${matched?.title ?? '...'}`
                  : 'Unmatched'
              return (
                <li
                  key={d.id}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', d.id)}
                  className="border rounded p-2 bg-white cursor-grab"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm" title={d.file_name}>{d.file_name}</span>
                    {d.staged_condition_id && !d.confirmed && (
                      <Button size="sm" variant="outline" onClick={() => stageOnCondition(d.id, d.staged_condition_id)}>
                        Confirm
                      </Button>
                    )}
                    {d.staged_condition_id && (
                      <Button size="sm" variant="ghost" onClick={() => stageOnCondition(d.id, null)} aria-label="Clear match">
                        x
                      </Button>
                    )}
                  </div>
                  <div className="mt-1">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded ${pillClass}`}>{pillText}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="flex flex-col overflow-hidden">
          <h3 className="text-sm font-semibold mb-2">Conditions</h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-4">
            {[...CONDITION_CATEGORIES, { value: 'uncategorized' as const, label: 'Other' }].map(cat => {
              const list = grouped[cat.value] ?? []
              if (list.length === 0) return null
              return (
                <div key={cat.value}>
                  <h4 className="text-xs uppercase text-gray-500 mb-1">{cat.label}</h4>
                  <ul className="space-y-1">
                    {list.map(c => {
                      const staged = docs.filter(d => d.staged_condition_id === c.id)
                      return (
                        <li
                          key={c.id}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => {
                            e.preventDefault()
                            const docId = e.dataTransfer.getData('text/plain')
                            if (docId) stageOnCondition(docId, c.id)
                          }}
                          className="border rounded p-2 bg-white"
                        >
                          <div className="text-sm font-medium">{c.title}</div>
                          {staged.length > 0 && (
                            <ul className="mt-1 ml-2 text-xs text-gray-700 space-y-0.5">
                              {staged.map(d => (
                                <li key={d.id} className="flex items-center gap-2">
                                  <span className="flex-1 truncate">{d.file_name}</span>
                                  <button
                                    onClick={() => stageOnCondition(d.id, null)}
                                    className="text-gray-400 hover:text-gray-700"
                                    aria-label="Remove"
                                  >x</button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <footer className="px-6 py-4 border-t flex items-center justify-between">
        <div className="text-sm">
          {error && <span className="text-red-600">{error}</span>}
          {!error && <span className="text-gray-600">{confirmedCount()} of {docs.length} confirmed</span>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Close</Button>
          <Button onClick={onSave} disabled={saving || confirmedCount() === 0}>
            {saving ? 'Saving...' : `Save ${confirmedCount()} match${confirmedCount() === 1 ? '' : 'es'}`}
          </Button>
        </div>
      </footer>
    </>
  )
}
