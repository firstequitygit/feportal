'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type ConditionTemplate, type LoanType, type ConditionCategory, type AssignedTo, CONDITION_CATEGORIES } from '@/lib/types'

const LOAN_TYPES: LoanType[] = ['Fix & Flip (Bridge)', 'Rental (DSCR)', 'New Construction']

const ASSIGNEE_OPTIONS: { value: AssignedTo; label: string }[] = [
  { value: 'borrower',        label: 'Borrower' },
  { value: 'loan_officer',    label: 'Loan Officer' },
  { value: 'loan_processor',  label: 'Loan Processor' },
  { value: 'underwriter',     label: 'Underwriter' },
]
const ASSIGNEE_LABEL: Record<AssignedTo, string> = Object.fromEntries(
  ASSIGNEE_OPTIONS.map(o => [o.value, o.label])
) as Record<AssignedTo, string>

interface Props {
  initialTemplates: ConditionTemplate[]
  apiPath?: string
}

export function AdminTemplatesManager({ initialTemplates, apiPath = '/api/admin/templates' }: Props) {
  const [templates, setTemplates] = useState<ConditionTemplate[]>(initialTemplates)
  const [saving, setSaving] = useState(false)

  // New template form
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newLoanType, setNewLoanType] = useState<LoanType | ''>('')
  const [newCategory, setNewCategory] = useState<ConditionCategory | ''>('')
  const [newAssignedTo, setNewAssignedTo] = useState<AssignedTo>('borrower')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editLoanType, setEditLoanType] = useState<LoanType | ''>('')
  const [editCategory, setEditCategory] = useState<ConditionCategory | ''>('')
  const [editAssignedTo, setEditAssignedTo] = useState<AssignedTo>('borrower')

  async function handleAdd() {
    if (!newTitle.trim()) return
    setSaving(true)
    const res = await fetch(apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle,
        description: newDescription,
        loan_type: newLoanType || null,
        category: newCategory || null,
        assigned_to: newAssignedTo,
      }),
    })
    const data = await res.json()
    if (data.success) {
      setTemplates(prev => [...prev, data.template])
      setNewTitle('')
      setNewDescription('')
      setNewLoanType('')
      setNewCategory('')
      setNewAssignedTo('borrower')
    }
    setSaving(false)
  }

  function startEdit(t: ConditionTemplate) {
    setEditingId(t.id)
    setEditTitle(t.title)
    setEditDescription(t.description ?? '')
    setEditLoanType(t.loan_type ?? '')
    setEditCategory(t.category ?? '')
    setEditAssignedTo(t.assigned_to ?? 'borrower')
  }

  async function handleSaveEdit(id: string) {
    setSaving(true)
    const res = await fetch(apiPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        title: editTitle,
        description: editDescription,
        loan_type: editLoanType || null,
        category: editCategory || null,
        assigned_to: editAssignedTo,
      }),
    })
    const data = await res.json()
    if (data.success) {
      setTemplates(prev => prev.map(t => t.id === id
        ? {
            ...t,
            title: editTitle,
            description: editDescription || null,
            loan_type: (editLoanType || null) as LoanType | null,
            category: (editCategory || null) as ConditionCategory | null,
            assigned_to: editAssignedTo,
          }
        : t
      ))
      setEditingId(null)
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return
    setSaving(true)
    const res = await fetch(apiPath, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const data = await res.json()
    if (data.success) setTemplates(prev => prev.filter(t => t.id !== id))
    setSaving(false)
  }

  const grouped = {
    universal: templates.filter(t => !t.loan_type),
    'Fix & Flip (Bridge)': templates.filter(t => t.loan_type === 'Fix & Flip (Bridge)'),
    'Rental (DSCR)':       templates.filter(t => t.loan_type === 'Rental (DSCR)'),
    'New Construction':    templates.filter(t => t.loan_type === 'New Construction'),
  }

  function renderTemplate(t: ConditionTemplate) {
    if (editingId === t.id) {
      return (
        <div key={t.id} className="border rounded-lg p-3 bg-green-50 space-y-2">
          <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Title" />
          <Input value={editDescription} onChange={e => setEditDescription(e.target.value)} placeholder="Description (optional)" />
          <select
            value={editLoanType}
            onChange={e => setEditLoanType(e.target.value as LoanType | '')}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
          >
            <option value="">All loan types</option>
            {LOAN_TYPES.map(lt => <option key={lt} value={lt}>{lt}</option>)}
          </select>
          <select
            value={editCategory}
            onChange={e => setEditCategory(e.target.value as ConditionCategory | '')}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
          >
            <option value="">Uncategorized</option>
            {CONDITION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select
            value={editAssignedTo}
            onChange={e => setEditAssignedTo(e.target.value as AssignedTo)}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
          >
            {ASSIGNEE_OPTIONS.map(o => <option key={o.value} value={o.value}>Assigned to: {o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleSaveEdit(t.id)} disabled={saving || !editTitle.trim()}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
          </div>
        </div>
      )
    }

    const categoryLabel = CONDITION_CATEGORIES.find(c => c.value === t.category)?.label.replace(' Conditions', '')
    return (
      <div key={t.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border rounded-lg p-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{t.title}</p>
          {t.description && <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>}
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${t.category ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
              {categoryLabel ?? 'Uncategorized'}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
              {ASSIGNEE_LABEL[t.assigned_to] ?? 'Borrower'}
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => startEdit(t)} className="text-xs text-primary hover:opacity-80">Edit</button>
          <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:underline">Delete</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Add New */}
      <Card>
        <CardHeader><CardTitle className="text-base">Add New Template</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Condition title (e.g. Proof of Insurance)"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
          />
          <Input
            placeholder="Description (optional)"
            value={newDescription}
            onChange={e => setNewDescription(e.target.value)}
          />
          <select
            value={newLoanType}
            onChange={e => setNewLoanType(e.target.value as LoanType | '')}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All loan types (universal)</option>
            {LOAN_TYPES.map(lt => <option key={lt} value={lt}>{lt}</option>)}
          </select>
          <select
            value={newCategory}
            onChange={e => setNewCategory(e.target.value as ConditionCategory | '')}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Uncategorized</option>
            {CONDITION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select
            value={newAssignedTo}
            onChange={e => setNewAssignedTo(e.target.value as AssignedTo)}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ASSIGNEE_OPTIONS.map(o => <option key={o.value} value={o.value}>Assigned to: {o.label}</option>)}
          </select>
          <Button size="sm" onClick={handleAdd} disabled={saving || !newTitle.trim()}>
            Add Template
          </Button>
        </CardContent>
      </Card>

      {/* Universal */}
      <Card>
        <CardHeader><CardTitle className="text-base">Universal (all loan types) — {grouped.universal.length}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {grouped.universal.length === 0
            ? <p className="text-sm text-gray-400">No universal templates yet.</p>
            : grouped.universal.map(renderTemplate)}
        </CardContent>
      </Card>

      {/* Per loan type */}
      {LOAN_TYPES.map(lt => (
        <Card key={lt}>
          <CardHeader><CardTitle className="text-base">{lt} — {grouped[lt].length}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {grouped[lt].length === 0
              ? <p className="text-sm text-gray-400">No {lt} templates yet.</p>
              : grouped[lt].map(renderTemplate)}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
