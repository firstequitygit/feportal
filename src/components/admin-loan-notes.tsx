'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface LoanNote {
  id: string
  loan_id: string
  content: string
  created_by: string
  created_at: string
}

interface Props {
  loanId: string
  initialNotes: LoanNote[]
  apiPath?: string
}

function formatDateTime(val: string): string {
  return new Date(val).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function AdminLoanNotes({ loanId, initialNotes, apiPath = '/api/admin/notes' }: Props) {
  const [notes, setNotes] = useState<LoanNote[]>(initialNotes)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function addNote() {
    if (!content.trim()) return
    setSaving(true)
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, content }),
      })
      const data = await res.json()
      if (data.success) {
        setNotes(prev => [data.note as LoanNote, ...prev])
        setContent('')
        toast.success('Note saved')
      } else {
        toast.error(data.error ?? 'Failed to save note')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteNote(noteId: string) {
    try {
      const res = await fetch(apiPath, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      })
      const data = await res.json()
      if (data.success) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
        toast.success('Note deleted')
      } else {
        toast.error('Failed to delete note')
      }
    } catch {
      toast.error('Network error. Please try again.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Staff Notes
          <span className="ml-2 text-xs font-normal text-gray-400">internal — not visible to borrower</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add note */}
        <div className="space-y-2">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Add an internal note..."
            rows={3}
            className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
          <Button
            size="sm"
            onClick={addNote}
            disabled={saving || !content.trim()}
          >
            {saving ? 'Saving…' : 'Add Note'}
          </Button>
        </div>

        {/* Notes list */}
        {notes.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-gray-100">
            {notes.map(note => (
              <div key={note.id} className="group relative bg-gray-50 rounded-lg p-3">
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{note.content}</p>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-gray-400">
                    {note.created_by} · {formatDateTime(note.created_at)}
                  </p>
                  <button
                    onClick={() => deleteNote(note.id)}
                    className="text-xs text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {notes.length === 0 && (
          <p className="text-sm text-gray-400">No notes yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
