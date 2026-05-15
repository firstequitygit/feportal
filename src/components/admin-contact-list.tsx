'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface ContactRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  /** For brokers — optional company name. Borrowers leave this null. */
  company_name?: string | null
  /** Number of loans linked to this contact (for the "in use" warning on delete). */
  loanCount?: number
}

interface Props {
  /** Plural label for the empty state and confirm dialog (e.g. "borrowers"). */
  label: string
  /** Singular label used in confirm copy (e.g. "borrower"). */
  singular: string
  /** API DELETE endpoint that takes `{ id }` in the body. */
  apiPath: string
  initialContacts: ContactRow[]
}

export function AdminContactList({ label, singular, apiPath, initialContacts }: Props) {
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  async function handleDelete(c: ContactRow) {
    const name = c.full_name ?? c.email
    const loanWarning = c.loanCount && c.loanCount > 0
      ? `\n\nThey are currently on ${c.loanCount} loan${c.loanCount === 1 ? '' : 's'} — their slot will be cleared (loans stay intact).`
      : ''
    if (!confirm(`Delete ${singular} ${name}?${loanWarning}\n\nThis also removes their portal login. This can't be undone.`)) return

    setDeletingId(c.id)
    try {
      const res = await fetch(apiPath, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id }),
      })
      const data = await res.json()
      if (data.success) {
        setContacts(prev => prev.filter(x => x.id !== c.id))
        toast.success(`${singular[0].toUpperCase()}${singular.slice(1)} deleted`)
      } else {
        toast.error(data.error ?? 'Failed to delete')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setDeletingId(null)
    }
  }

  const visible = contacts.filter(c => {
    if (!filter.trim()) return true
    const q = filter.trim().toLowerCase()
    return (
      (c.full_name ?? '').toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company_name ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">
          {label[0].toUpperCase() + label.slice(1)}{' '}
          <span className="text-sm font-normal text-gray-400">{contacts.length}</span>
        </CardTitle>
        <input
          type="text"
          placeholder={`Search ${label}...`}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1 w-48 focus:outline-none focus:border-primary/40"
        />
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No {label} yet.</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No {label} match &quot;{filter}&quot;.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {visible.map(c => (
              <div key={c.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.full_name ?? c.email}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {c.email}
                    {c.company_name ? <> · {c.company_name}</> : null}
                    {c.phone ? <> · {c.phone}</> : null}
                  </p>
                  {c.loanCount != null && c.loanCount > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      On {c.loanCount} loan{c.loanCount === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(c)}
                  disabled={deletingId === c.id}
                  className="text-gray-400 hover:text-red-500 disabled:opacity-40"
                  title={`Delete ${singular}`}
                >
                  {deletingId === c.id
                    ? <span className="text-xs">Deleting…</span>
                    : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
