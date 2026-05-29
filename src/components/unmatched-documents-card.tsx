'use client'

import { useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/collapsible-card'
import { Button } from '@/components/ui/button'

export type UnmatchedDoc = {
  id: string
  file_name: string
  file_path: string
  file_size: number | null
  uploaded_by_user_id: string | null
  created_at: string
}

type Props = {
  loanId: string
  onMatchClick: (docs: UnmatchedDoc[]) => void
  refreshKey?: number
}

export function UnmatchedDocumentsCard({ loanId, onMatchClick, refreshKey }: Props) {
  const [docs, setDocs] = useState<UnmatchedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/loans/${loanId}/documents/unmatched`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setDocs(data.documents ?? []) })
      .catch(() => { if (!cancelled) setError('Could not load unmatched documents') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loanId, refreshKey])

  async function handleDelete(docId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return
    setDeletingId(docId)
    setError(null)
    const res = await fetch('/api/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: docId }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      setDocs(prev => prev.filter(d => d.id !== docId))
    } else {
      setError(data.error ?? `Failed to delete "${fileName}"`)
    }
    setDeletingId(null)
  }

  if (loading) return null
  if (docs.length === 0) return null

  return (
    <CollapsibleCard title={`Unmatched documents (${docs.length})`} defaultOpen>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <ul className="divide-y divide-gray-200">
        {docs.map(d => (
          <li key={d.id} className="py-2 flex items-center gap-3">
            <span className="flex-1 truncate text-sm" title={d.file_name}>{d.file_name}</span>
            <span className="text-xs text-gray-500">{new Date(d.created_at).toLocaleDateString()}</span>
            <Button size="sm" variant="outline" onClick={() => onMatchClick([d])}>Match</Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={deletingId === d.id}
              onClick={() => handleDelete(d.id, d.file_name)}
            >
              {deletingId === d.id ? 'Deleting...' : 'Delete'}
            </Button>
          </li>
        ))}
      </ul>
      {docs.length > 1 && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => onMatchClick(docs)}>Match all</Button>
        </div>
      )}
    </CollapsibleCard>
  )
}
