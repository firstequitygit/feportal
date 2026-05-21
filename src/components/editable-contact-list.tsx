'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Check, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export interface EditableContactRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  /** Brokers only; pass null for borrowers. */
  company_name?: string | null
  /** Optional context line under the row, e.g. "On 3 loans". */
  subtitle?: string | null
}

interface Props {
  /** Plural label for header + empty state ("borrowers" / "brokers"). */
  label: string
  /** API PATCH endpoint that takes { id, full_name, email, phone, company_name? } in the body. */
  apiPath: string
  /** Show + edit a company_name field too. Set true for brokers. */
  withCompany?: boolean
  initialContacts: EditableContactRow[]
}

export function EditableContactList({ label, apiPath, withCompany = false, initialContacts }: Props) {
  const [contacts, setContacts] = useState<EditableContactRow[]>(initialContacts)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<{ full_name: string; email: string; phone: string; company_name: string }>({
    full_name: '', email: '', phone: '', company_name: '',
  })
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  function startEdit(c: EditableContactRow) {
    setEditingId(c.id)
    setForm({
      full_name: c.full_name ?? '',
      email: c.email,
      phone: c.phone ?? '',
      company_name: c.company_name ?? '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    if (!form.email.trim()) { toast.error('Email is required'); return }
    setSaving(true)
    try {
      const body: Record<string, string | null> = {
        id,
        full_name: form.full_name.trim() || null,
        email: form.email.trim(),
        phone: form.phone.trim() || null,
      }
      if (withCompany) body.company_name = form.company_name.trim() || null

      const res = await fetch(apiPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setContacts(prev => prev.map(c => c.id === id
          ? {
              ...c,
              full_name: body.full_name as string | null,
              email: body.email as string,
              phone: body.phone as string | null,
              company_name: withCompany ? (body.company_name as string | null) : c.company_name,
            }
          : c
        ))
        setEditingId(null)
        toast.success('Saved')
      } else {
        toast.error(data.error ?? 'Failed to save')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
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
          <p className="text-sm text-gray-400 py-2">No {label} on your loans yet.</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No {label} match &quot;{filter}&quot;.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {visible.map(c => editingId === c.id ? (
              <div key={c.id} className="py-3 space-y-2">
                <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Full name" />
                {withCompany && (
                  <Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Company (optional)" />
                )}
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" />
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" />
                <div className="flex gap-2 pt-1">
                  <button onClick={() => saveEdit(c.id)} disabled={saving} className="flex items-center gap-1 text-xs text-green-600 hover:opacity-80 disabled:opacity-40">
                    <Check className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={cancelEdit} className="flex items-center gap-1 text-xs text-gray-400 hover:opacity-80">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={c.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.full_name ?? c.email}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {c.email}
                    {c.company_name ? <> · {c.company_name}</> : null}
                    {c.phone ? <> · {c.phone}</> : null}
                  </p>
                  {c.subtitle && (
                    <p className="text-xs text-gray-400 mt-0.5">{c.subtitle}</p>
                  )}
                </div>
                <button onClick={() => startEdit(c)} className="text-gray-400 hover:text-primary" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
