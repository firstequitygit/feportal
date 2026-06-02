'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2, Plus, ShieldCheck, Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface AdminRow {
  id: string
  full_name: string | null
  email: string
  is_super: boolean
  created_at: string
}

interface Props {
  initialAdmins: AdminRow[]
  /** The viewer's own admin_users.id — block self-delete. */
  currentUserId: string
  /** Only super-admins see the Add/Delete affordances. Regular admins get
   *  a read-only roster. Server enforces the same gate via verifySuperAdmin. */
  isSuper: boolean
}

export function AdminUsersManager({ initialAdmins, currentUserId, isSuper }: Props) {
  const [admins, setAdmins] = useState<AdminRow[]>(initialAdmins)
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState({ email: '', full_name: '' })
  const [saving, setSaving] = useState(false)
  const [createdInfo, setCreatedInfo] = useState<{ email: string; tempPassword: string } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Inline-edit state: when editingId is set, that row swaps the static
  // name for an Input + Save/Cancel. editDraft holds the working value
  // so cancel doesn't have to refetch.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  function startEdit(a: AdminRow) {
    setEditingId(a.id)
    setEditDraft(a.full_name ?? '')
  }
  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
  }
  async function saveEdit(a: AdminRow) {
    const next = editDraft.trim()
    if (!next) { toast.error('Name cannot be empty'); return }
    if (next === (a.full_name ?? '')) { cancelEdit(); return }
    setSavingEdit(true)
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, full_name: next }),
      })
      const data = await res.json()
      if (data.success) {
        setAdmins(prev => prev.map(x => x.id === a.id ? { ...x, full_name: data.admin.full_name } : x))
        cancelEdit()
        toast.success('Name updated')
      } else {
        toast.error(data.error ?? 'Failed to update')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleAdd() {
    if (!newForm.email.trim() || !newForm.full_name.trim()) {
      toast.error('Email and full name are required')
      return
    }
    setSaving(true)
    setCreatedInfo(null)
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      })
      const data = await res.json()
      if (data.success) {
        setAdmins(prev => [...prev, data.admin])
        setCreatedInfo({ email: newForm.email, tempPassword: data.tempPassword })
        setNewForm({ email: '', full_name: '' })
        setAdding(false)
        toast.success('Admin created — copy the temp password below')
      } else {
        toast.error(data.error ?? 'Failed to add admin')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(a: AdminRow) {
    if (a.id === currentUserId) { toast.error("You can't delete your own admin login."); return }
    if (a.is_super) {
      if (!confirm(`${a.full_name ?? a.email} is a super-admin. Delete anyway?`)) return
    } else {
      if (!confirm(`Delete admin ${a.full_name ?? a.email}? This removes their portal login.`)) return
    }
    setDeletingId(a.id)
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id }),
      })
      const data = await res.json()
      if (data.success) {
        setAdmins(prev => prev.filter(x => x.id !== a.id))
        toast.success('Admin deleted')
      } else {
        toast.error(data.error ?? 'Failed to delete')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setDeletingId(null)
    }
  }

  async function copyPassword() {
    if (!createdInfo) return
    await navigator.clipboard.writeText(createdInfo.tempPassword)
    toast.success('Password copied')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">
          Admin Users <span className="text-sm font-normal text-gray-400">{admins.length}</span>
        </CardTitle>
        {isSuper && !adding && (
          <Button size="sm" variant="outline" onClick={() => { setAdding(true); setCreatedInfo(null) }}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Admin
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Add form */}
        {adding && (
          <div className="border border-primary/30 rounded-lg p-4 space-y-3 bg-primary/5">
            <p className="text-sm font-medium text-gray-700">New Admin</p>
            <div className="space-y-1.5">
              <Label htmlFor="new-admin-name">Full name</Label>
              <Input
                id="new-admin-name"
                placeholder="Jane Admin"
                value={newForm.full_name}
                onChange={e => setNewForm(f => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-admin-email">Email</Label>
              <Input
                id="new-admin-email"
                type="email"
                placeholder="admin@example.com"
                value={newForm.email}
                onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleAdd} disabled={saving}>
                {saving ? 'Creating…' : 'Create admin'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setNewForm({ email: '', full_name: '' }) }}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              A temporary password will be generated. Share it with the new admin out-of-band.
              They can reset it via the &quot;Forgot password&quot; flow on the login page.
            </p>
          </div>
        )}

        {/* Just-created banner */}
        {createdInfo && (
          <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium text-green-900">✓ Admin created for {createdInfo.email}</p>
            <p className="text-xs text-green-800">Share this temp password manually:</p>
            <div className="flex gap-2 items-center">
              <code className="text-sm bg-white px-3 py-1.5 rounded border border-green-200 font-mono flex-1">
                {createdInfo.tempPassword}
              </code>
              <Button size="sm" onClick={copyPassword}>Copy</Button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="divide-y divide-gray-100">
          {admins.map(a => {
            const isEditing = editingId === a.id
            return (
              <div key={a.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input
                        autoFocus
                        value={editDraft}
                        onChange={e => setEditDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); saveEdit(a) }
                          if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                        }}
                        className="h-8 text-sm max-w-xs"
                        placeholder="Full name"
                      />
                      <Button size="sm" onClick={() => saveEdit(a)} disabled={savingEdit}>
                        {savingEdit ? 'Saving…' : 'Save'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelEdit} disabled={savingEdit}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{a.full_name ?? a.email}</p>
                      {a.is_super && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          <ShieldCheck className="w-3 h-3" /> Super
                        </span>
                      )}
                      {a.id === currentUserId && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">You</span>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 truncate">{a.email}</p>
                </div>
                {isSuper && !isEditing && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => startEdit(a)}
                      title="Edit name"
                      className="text-gray-400 hover:text-primary"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(a)}
                      disabled={deletingId === a.id || a.id === currentUserId}
                      title={a.id === currentUserId ? "You can't delete yourself" : 'Delete admin'}
                      className="text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deletingId === a.id
                        ? <span className="text-xs">Deleting…</span>
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
