'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2, Pencil, X, Check, Plus, Mail } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type LoanOfficer } from '@/lib/types'

export function AdminLoanOfficersManager({ initialLoanOfficers }: { initialLoanOfficers: LoanOfficer[] }) {
  const [loanOfficers, setLoanOfficers] = useState<LoanOfficer[]>(initialLoanOfficers)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', title: '', email: '', phone: '' })
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState({ full_name: '', title: '', email: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)

  function startEdit(lo: LoanOfficer) {
    setEditingId(lo.id)
    setEditForm({ full_name: lo.full_name, title: lo.title ?? '', email: lo.email ?? '', phone: lo.phone ?? '' })
  }

  async function saveEdit(id: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/loan-officers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editForm }),
      })
      const data = await res.json()
      if (data.success) {
        setLoanOfficers(prev => prev.map(lo => lo.id === id ? { ...lo, ...editForm, title: editForm.title || null, email: editForm.email || null, phone: editForm.phone || null } : lo))
        setEditingId(null)
        toast.success('Loan officer updated')
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
    if (!confirm(`Remove ${name} from loan officers?`)) return
    try {
      const res = await fetch('/api/admin/loan-officers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (data.success) {
        setLoanOfficers(prev => prev.filter(lo => lo.id !== id))
        toast.success('Loan officer removed')
      } else {
        toast.error(data.error ?? 'Failed to remove')
      }
    } catch {
      toast.error('Network error')
    }
  }

  async function handleInvite(lo: LoanOfficer) {
    if (!lo.email) { toast.error('Loan officer has no email address'); return }
    if (!confirm(`Send a portal invite to ${lo.full_name} at ${lo.email}?`)) return
    setInvitingId(lo.id)
    try {
      const res = await fetch('/api/admin/loan-officers/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanOfficerId: lo.id }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Invite sent to ${lo.email}`)
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
      const res = await fetch('/api/admin/loan-officers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      })
      const data = await res.json()
      if (data.success) {
        setLoanOfficers(prev => [...prev, data.loanOfficer])
        setNewForm({ full_name: '', title: '', email: '', phone: '' })
        setAdding(false)
        toast.success('Loan officer added')
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
        <CardTitle className="text-base">Loan Officers</CardTitle>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Loan Officer
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Add form */}
        {adding && (
          <div className="border border-primary/30 rounded-lg p-4 space-y-2 bg-primary/5">
            <p className="text-sm font-medium text-gray-700">New Loan Officer</p>
            <Input placeholder="Full name *" value={newForm.full_name} onChange={e => setNewForm(f => ({ ...f, full_name: e.target.value }))} />
            <Input placeholder="Title (e.g. Loan Officer)" value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} />
            <Input placeholder="Email" type="email" value={newForm.email} onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))} />
            <Input placeholder="Phone" value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} />
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setNewForm({ full_name: '', title: '', email: '', phone: '' }) }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* List */}
        {loanOfficers.length === 0 && !adding && (
          <p className="text-sm text-gray-400 py-2">No loan officers added yet.</p>
        )}

        <div className="divide-y divide-gray-100">
          {loanOfficers.map(lo => (
            <div key={lo.id} className="py-3">
              {editingId === lo.id ? (
                <div className="space-y-2">
                  <Input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Full name *" />
                  <Input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="Title" />
                  <Input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" type="email" />
                  <Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" />
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => saveEdit(lo.id)} disabled={saving} className="flex items-center gap-1 text-xs text-green-600 hover:opacity-80"><Check className="w-3.5 h-3.5" /> Save</button>
                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs text-gray-400 hover:opacity-80"><X className="w-3.5 h-3.5" /> Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{lo.full_name}</p>
                    {lo.title && <p className="text-xs text-gray-500">{lo.title}</p>}
                    {lo.email && <p className="text-xs text-gray-500">{lo.email}</p>}
                    {lo.phone && <p className="text-xs text-gray-500">{lo.phone}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleInvite(lo)}
                      disabled={invitingId === lo.id || !lo.email}
                      title={lo.email ? 'Send portal invite' : 'Add an email address first'}
                      className="text-gray-400 hover:text-primary disabled:opacity-40"
                    >
                      {invitingId === lo.id
                        ? <span className="text-xs">Sending…</span>
                        : <Mail className="w-3.5 h-3.5" />
                      }
                    </button>
                    <button onClick={() => startEdit(lo)} className="text-gray-400 hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleDelete(lo.id, lo.full_name)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
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
