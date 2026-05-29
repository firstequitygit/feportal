'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useImpersonation } from '@/components/impersonation-provider'

// One of four labeled buckets. Anyone with loan access can post in any
// bucket — the category is purely organizational. Mirrors the CHECK
// constraint in 20260529-loan-notes-category.sql.
type NoteCategory = 'loan_officer' | 'processor' | 'underwriter' | 'closer'

interface LoanNote {
  id: string
  loan_id: string
  content: string
  created_by: string
  created_at: string
  // Older notes pre-migration default to 'loan_officer' at the DB level,
  // so this is non-optional after the migration runs. Optional here so the
  // component doesn't blow up if the column is missing during a partial
  // rollout / local dev without the migration applied.
  category?: NoteCategory | null
}

interface Props {
  loanId: string
  initialNotes: LoanNote[]
  apiPath?: string
}

interface SectionMeta {
  key: NoteCategory
  title: string
  placeholder: string
}

// Render order — top to bottom in the card. Matches the typical loan
// lifecycle handoff: LO → Processor → Underwriter → Closer.
const SECTIONS: SectionMeta[] = [
  { key: 'loan_officer', title: 'Loan Officer Notes', placeholder: 'Add a loan officer note…' },
  { key: 'processor',    title: 'Processor Notes',    placeholder: 'Add a processor note…' },
  { key: 'underwriter',  title: 'Underwriter Notes',  placeholder: 'Add an underwriter note…' },
  { key: 'closer',       title: 'Closer Notes',       placeholder: 'Add a closer note…' },
]

function formatDateTime(val: string): string {
  return new Date(val).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function AdminLoanNotes({ loanId, initialNotes, apiPath = '/api/admin/notes' }: Props) {
  const { isImpersonating } = useImpersonation()
  const [notes, setNotes] = useState<LoanNote[]>(initialNotes)
  // One draft per section so typing in one bucket doesn't affect another.
  const [drafts, setDrafts] = useState<Record<NoteCategory, string>>({
    loan_officer: '', processor: '', underwriter: '', closer: '',
  })
  // Track which section is currently saving so we only disable that one
  // button (not all four).
  const [savingCategory, setSavingCategory] = useState<NoteCategory | null>(null)

  // Group notes by category once per render. Notes with no category (or
  // an unrecognized one) fall into loan_officer for safety.
  const notesByCategory = useMemo(() => {
    const buckets: Record<NoteCategory, LoanNote[]> = {
      loan_officer: [], processor: [], underwriter: [], closer: [],
    }
    for (const n of notes) {
      const k = (n.category ?? 'loan_officer') as NoteCategory
      ;(buckets[k] ?? buckets.loan_officer).push(n)
    }
    return buckets
  }, [notes])

  async function addNote(category: NoteCategory) {
    const content = drafts[category]
    if (!content.trim()) return
    setSavingCategory(category)
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, content, category }),
      })
      const data = await res.json()
      if (data.success) {
        setNotes(prev => [data.note as LoanNote, ...prev])
        setDrafts(prev => ({ ...prev, [category]: '' }))
        toast.success('Note saved')
      } else {
        toast.error(data.error ?? 'Failed to save note')
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSavingCategory(null)
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
      <CardContent className="space-y-6">
        {SECTIONS.map((section, idx) => {
          const sectionNotes = notesByCategory[section.key]
          const draft = drafts[section.key]
          const saving = savingCategory === section.key
          return (
            <section
              key={section.key}
              // Light divider between sections — same card so the whole
              // thing reads as one Staff Notes block, but the buckets are
              // visually distinct.
              className={idx === 0 ? '' : 'pt-6 border-t border-gray-100'}
            >
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                {section.title}
                {sectionNotes.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {sectionNotes.length}
                  </span>
                )}
              </h4>

              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={e => setDrafts(prev => ({ ...prev, [section.key]: e.target.value }))}
                  placeholder={section.placeholder}
                  rows={3}
                  className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
                <Button
                  size="sm"
                  onClick={isImpersonating ? undefined : () => addNote(section.key)}
                  disabled={saving || !draft.trim() || isImpersonating}
                  title={isImpersonating ? 'Read-only preview — exit View As to act' : undefined}
                  className={isImpersonating ? 'opacity-50 cursor-not-allowed' : undefined}
                >
                  {saving ? 'Saving…' : 'Add Note'}
                </Button>
              </div>

              {sectionNotes.length > 0 ? (
                <div className="space-y-3 mt-4">
                  {sectionNotes.map(note => (
                    <div key={note.id} className="group relative bg-gray-50 rounded-lg p-3">
                      <p className="text-sm text-gray-900 whitespace-pre-wrap">{note.content}</p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-gray-400">
                          {note.created_by} · {formatDateTime(note.created_at)}
                        </p>
                        {!isImpersonating && (
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="text-xs text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-3">No notes yet.</p>
              )}
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}
