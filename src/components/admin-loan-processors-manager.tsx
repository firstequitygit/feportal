'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2, Pencil, X, Check, Plus, Mail } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type LoanProcessor } from '@/lib/types'

export function AdminLoanProcessorsManager({ initialLoanProcessors }: { initialLoanProcessors: LoanProcessor[] }) {
  const [loanProcessors, setLoanProcessors] = useState<LoanProcessor[]>(initialLoanProcessors)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', title: '', email: '', phone: '' })
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState({ full_name: '', title: '', email: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)

  function startEdit(lp: LoanProcessor) {
    setEditingId(lp.id)
    setEditForm({ full_name: lp.full_name, title: lp.title ?? '', email: lp.email ?? '', phone: lp.phone ?? '' })
  }

  async function saveEdit(id: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/loan-processors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editForm }),
      })
      const data = await res.json()
      if (data.success) {
        setLoanProcessors(prev => prev.map(lp => lp.id === id ? { ...lp, ...editForm, title: editForm.title || null, email: editForm.email || null, phone: editForm.phone || null } : lp))
        setEditingId(null)
        toast.success('Loan processor updated')
      } else {
        toast.error(data.error ?? 'Failed to update')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove ${name} from loan processors?`)) return
    try {
      const res = await fetch('/api/admin/loan-processors', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (data.success) {
        setLoanProcessors(prev => prev.filter(lp => lp.id !== id))
        toast.success('Loan processor removed')
      } else {
        toast.error(data.error ?? 'Failed to remove')
      }
    } catch {
      toast.error('Network error')
    }
  }

  async function handleInvite(lp: LoanProcessor) {
    if (!lp.email) { toast.error('Loan processor has no email address'); return }
    if (!confirm(`Send a portal invite to ${lp.full_name} at ${lp.email}?`)) return
    setInvitingId(lp.id)
    try {
      const res = await fetch('/api/admin/loan-processors/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanProcessorId: lp.id }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Invite sent to ${lp.email}`)
      } else {
        toast.error(data.error ?? 'Failed to send invite')
      }
    } catch {
      toast.error('Network error sending invite')
    } finally {
      setInvitingId(null)
    }
  }

  async function handleAdd() {
    if (!newForm.full_name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/loan-processors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      })
      const data = await res.json()
      if (data.success) {
        setLoanProcessors(prev => [...prev, data.loanProcessor])
        setNewForm({ full_name: '', title: '', email: '', phone: '' })
        setAdding(false)
        toast.success('Loan processor added')
      } else {
        toast.error(data.error ?? 'Failed to add')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Loan Processors</CardTitle>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Loan Processor
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <div className="border border-primary/30 rounded-lg p-4 space-y-2 bg-primary/5">
            <p className="text-sm font-medium text-gray-700">New Loan Processor</p>
            <Input placeholder="Full name *" value={newForm.full_name} onChange={e => setNewForm(f => ({ ...f, full_name: e.target.value }))} />
            <Input placeholder="Title (e.g. Loan Processor)" value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} />
            <Input placeholder="Email" type="email" value={newForm.email} onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))} />
            <Input placeholder="Phone" value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} />
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setNewForm({ full_name: '', title: '', email: '', phone: '' }) }}>Cancel</Button>
            </div>
          </div>
        )}

        {loanProcessors.length === 0 && !adding && (
          <p className="text-sm text-gray-400 py-2">No loan processors added yet.</p>
        )}

        <div className="divide-y divide-gray-100">
          {loanProcessors.map(lp => (
            <div key={lp.id} className="py-3">
              {editingId === lp.id ? (
                <div className="space-y-2">
                  <Input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Full name *" />
                  <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" />
                  <Input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" type="email" />
                  <Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" />
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => saveEdit(lp.id)} disabled={saving} className="flex items-center gap-1 text-xs text-green-600 hover:opacity-80"><Check className="w-3.5 h-3.5" /> Save</button>
                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs text-gray-400 hover:opacity-80"><X className="w-3.5 h-3.5" /> Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{lp.full_name}</p>
                    {lp.title && <p className="text-xs text-gray-500">{lp.title}</p>}
                    {lp.email && <p className="text-xs text-gray-500">{lp.email}</p>}
                    {lp.phone && <p className="text-xs text-gray-500">{lp.phone}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleInvite(lp)}
                      disabled={invitingId === lp.id || !lp.email}
                      title={lp.email ? 'Send portal invite' : 'Add an email address first'}
                      className="text-gray-400 hover:text-primary disabled:opacity-40"
                    >
                      {invitingId === lp.id ? <span className="text-xs">Sending…</span> : <Mail className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => startEdit(lp)} className="text-gray-400 hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleDelete(lp.id, lp.full_name)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
