'use client'

import { useState } from 'react'
import { toast } from 'sonner'

export interface ConditionNote {
  id: string
  condition_id: string
  content: string
  created_by: string
  created_at: string
}

interface Props {
  conditionId: string
  initialNotes: ConditionNote[]
  /** Disables the composer + delete buttons while admin is View-As-ing. */
  isImpersonating?: boolean
}

function formatDateTime(val: string): string {
  return new Date(val).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/**
 * Per-condition staff notes thread. Sits beneath each condition row on the
 * LO / LP / UW loan detail pages. Borrower-facing condition views do NOT
 * render this — the access check is at the /api/conditions/notes route
 * too, so even an unauthorized fetch would be rejected.
 *
 * Always-rendered (collapsed by default if no notes); a "Add note" link
 * opens an inline composer so it doesn't dominate the condition card when
 * empty.
 */
export function ConditionNotes({ conditionId, initialNotes, isImpersonating = false }: Props) {
  const [notes, setNotes] = useState<ConditionNote[]>(initialNotes)
  const [adding, setAdding] = useState(false)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function addNote() {
    if (!content.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/conditions/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditionId, content }),
      })
      const data = await res.json()
      if (data.success) {
        setNotes(prev => [data.note as ConditionNote, ...prev])
        setContent('')
        setAdding(false)
      } else {
        toast.error(data.error ?? 'Failed to save note')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteNote(noteId: string) {
    if (!confirm('Delete this note?')) return
    try {
      const res = await fetch('/api/conditions/notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      })
      const data = await res.json()
      if (data.success) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
      } else {
        toast.error('Failed to delete note')
      }
    } catch {
      toast.error('Network error')
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Staff Notes
          <span className="ml-2 text-[10px] font-normal text-gray-400 normal-case tracking-normal">
            internal — not visible to borrowers
          </span>
        </p>
        {!adding && !isImpersonating && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs text-primary hover:opacity-80"
          >
            + Add note
          </button>
        )}
      </div>

      {/* Composer */}
      {adding && (
        <div className="space-y-2 mb-3">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Leave a note for the rest of the team…"
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={addNote}
              disabled={saving || !content.trim()}
              className="text-xs bg-primary text-white px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add Note'}
            </button>
            <button
              onClick={() => { setAdding(false); setContent('') }}
              disabled={saving}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Notes list */}
      {notes.length === 0 && !adding && (
        <p className="text-xs text-gray-400">No notes yet.</p>
      )}
      {notes.length > 0 && (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="group bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{note.content}</p>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[11px] text-gray-500">
                  {note.created_by} · {formatDateTime(note.created_at)}
                </p>
                {!isImpersonating && (
                  <button
                    onClick={() => deleteNote(note.id)}
                    className="text-[11px] text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
