'use client'

import { useState, useMemo } from 'react'
import JSZip from 'jszip'
import { Download, Loader2 } from 'lucide-react'
import { DocumentPreviewLink } from '@/components/document-preview-link'

export interface DocumentRow {
  id: string
  file_name: string
  file_size: number | null
  created_at: string
  condition_id: string | null
  signedUrl: string | null
}

interface Props {
  documents: DocumentRow[]
  /** Optional map of condition_id → condition title, used for the inline subtitle. */
  conditionMap?: Record<string, string>
  /** Prefix used in the downloaded zip filename. Spaces/slashes/etc. are sanitized. */
  zipFilenamePrefix?: string
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-z0-9_\-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'documents'
}

/** Disambiguate identical filenames across the selection by suffixing copies. */
function uniquifyName(name: string, used: Set<string>): string {
  if (!used.has(name)) { used.add(name); return name }
  const dot = name.lastIndexOf('.')
  const base = dot === -1 ? name : name.slice(0, dot)
  const ext  = dot === -1 ? ''   : name.slice(dot)
  let n = 2
  while (used.has(`${base} (${n})${ext}`)) n++
  const out = `${base} (${n})${ext}`
  used.add(out)
  return out
}

export function DocumentsList({ documents, conditionMap, zipFilenamePrefix }: Props) {
  const downloadable = useMemo(() => documents.filter(d => d.signedUrl), [documents])

  // Selection state — only over rows that actually have a signedUrl.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allSelected = downloadable.length > 0 && selected.size === downloadable.length
  const someSelected = selected.size > 0 && !allSelected

  function toggleOne(id: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(downloadable.map(d => d.id)) : new Set())
  }

  async function downloadSelected() {
    if (selected.size === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const toFetch = downloadable.filter(d => selected.has(d.id))

      // Single file → bypass zip, save directly with the original filename.
      if (toFetch.length === 1) {
        const d = toFetch[0]
        const res = await fetch(d.signedUrl!)
        if (!res.ok) throw new Error(`Failed to fetch ${d.file_name}`)
        const blob = await res.blob()
        triggerDownload(blob, d.file_name)
        setSelected(new Set())
        return
      }

      const zip = new JSZip()
      const usedNames = new Set<string>()
      // Fetch in parallel but cap concurrency so we don't hammer the browser.
      const CONCURRENCY = 4
      let idx = 0
      async function worker() {
        while (idx < toFetch.length) {
          const i = idx++
          const d = toFetch[i]
          const res = await fetch(d.signedUrl!)
          if (!res.ok) throw new Error(`Failed to fetch ${d.file_name} (${res.status})`)
          const blob = await res.blob()
          zip.file(uniquifyName(d.file_name, usedNames), blob)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker))

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const stamp = new Date().toISOString().slice(0, 10)
      const prefix = sanitizeForFilename(zipFilenamePrefix ?? 'documents')
      triggerDownload(zipBlob, `${prefix}-${stamp}.zip`)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (documents.length === 0) {
    return <p className="text-sm text-gray-500 py-2">No documents uploaded yet.</p>
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 pb-2 mb-1 border-b border-gray-100">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-primary"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected }}
            onChange={e => toggleAll(e.target.checked)}
            disabled={downloadable.length === 0}
          />
          {selected.size === 0
            ? `Select all (${downloadable.length})`
            : `${selected.size} selected`}
        </label>
        <button
          type="button"
          onClick={downloadSelected}
          disabled={selected.size === 0 || busy}
          className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-md"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {busy
            ? 'Packaging...'
            : selected.size <= 1
              ? 'Download selected'
              : `Download ${selected.size} as zip`}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      {/* Rows */}
      <div className="divide-y divide-gray-100">
        {documents.map(doc => {
          const conditionLabel = doc.condition_id ? conditionMap?.[doc.condition_id] : undefined
          const isSelectable = !!doc.signedUrl
          return (
            <div key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <input
                  type="checkbox"
                  className="accent-primary mt-1 shrink-0 disabled:opacity-30"
                  checked={selected.has(doc.id)}
                  onChange={e => toggleOne(doc.id, e.target.checked)}
                  disabled={!isSelectable}
                  aria-label={`Select ${doc.file_name}`}
                />
                <span className="text-gray-400 shrink-0 mt-0.5">📄</span>
                <div className="min-w-0">
                  {doc.signedUrl ? (
                    <DocumentPreviewLink
                      url={doc.signedUrl}
                      fileName={doc.file_name}
                      className="text-sm text-gray-900 truncate text-left hover:text-primary underline underline-offset-2 block max-w-full"
                    />
                  ) : (
                    <p className="text-sm text-gray-900 truncate">{doc.file_name}</p>
                  )}
                  {conditionLabel && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">Condition: {conditionLabel}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {doc.file_size != null && (
                  <span className="text-xs text-gray-400 hidden sm:block">{formatFileSize(doc.file_size)}</span>
                )}
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
