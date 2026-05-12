'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type Condition, type ConditionTemplate, type ConditionStatus, type AssignedTo, type LoanType, type ConditionCategory, CONDITION_CATEGORIES } from '@/lib/types'

interface Props {
  loanId: string
  loanType: LoanType | null
  conditions: Condition[]
  templates: ConditionTemplate[]
  propertyAddress?: string | null
}

const STATUS_OPTIONS: ConditionStatus[] = ['Outstanding', 'Received', 'Satisfied', 'Waived', 'Rejected']

function statusColor(status: ConditionStatus): string {
  switch (status) {
    case 'Outstanding': return 'bg-red-100 text-red-700'
    case 'Received':    return 'bg-yellow-100 text-yellow-700'
    case 'Satisfied':   return 'bg-green-100 text-green-700'
    case 'Waived':      return 'bg-gray-100 text-gray-500'
    case 'Rejected':    return 'bg-red-100 text-red-800'
  }
}

function assignedToColor(assigned_to: AssignedTo): string {
  switch (assigned_to) {
    case 'loan_officer':   return 'bg-blue-100 text-blue-700'
    case 'loan_processor': return 'bg-purple-100 text-purple-700'
    default:               return 'bg-gray-100 text-gray-500'
  }
}

function assignedToLabel(assigned_to: AssignedTo): string {
  switch (assigned_to) {
    case 'loan_officer':   return 'Loan Officer'
    case 'loan_processor': return 'Loan Processor'
    default:               return 'Borrower'
  }
}

export function AdminConditionsManager({ loanId, loanType, conditions, templates, propertyAddress }: Props) {
  const [saving, setSaving] = useState(false)
  const [uploadingSet, setUploadingSet] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<{ conditionId: string; conditionTitle: string } | null>(null)

  async function uploadSingleFile(file: File, conditionId: string, conditionTitle: string): Promise<void> {
    const urlRes = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, conditionId, fileName: file.name, conditionTitle, propertyAddress }),
    })
    const urlData = await urlRes.json()
    if (!urlData.signedUrl) throw new Error(urlData.error ?? 'Failed to get upload URL')

    const uploadRes = await fetch(urlData.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!uploadRes.ok) throw new Error(`Storage upload failed for "${file.name}"`)

    const recordRes = await fetch('/api/admin/upload/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, conditionId, fileName: file.name, fileSize: file.size, path: urlData.path }),
    })
    const recordData = await recordRes.json()
    if (!recordData.success) throw new Error(recordData.error ?? 'Failed to record document')
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !uploadTargetRef.current) return
    const { conditionId, conditionTitle } = uploadTargetRef.current

    setUploadingSet(prev => new Set(prev).add(conditionId))

    let successCount = 0
    for (const file of files) {
      try {
        await uploadSingleFile(file, conditionId, conditionTitle)
        successCount++
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Upload failed for "${file.name}"`)
      }
    }

    if (successCount > 0) {
      toast.success(successCount === 1
        ? `"${files[0].name}" uploaded successfully`
        : `${successCount} files uploaded successfully`
      )
    }

    setUploadingSet(prev => {
      const next = new Set(prev)
      next.delete(conditionId)
      return next
    })
    uploadTargetRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function triggerUpload(conditionId: string, conditionTitle: string) {
    uploadTargetRef.current = { conditionId, conditionTitle }
    if (fileInputRef.current) {
      fileInputRef.current.multiple = true
      fileInputRef.current.click()
    }
  }

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newAssignedTo, setNewAssignedTo] = useState<AssignedTo>('borrower')
  const [newCategory, setNewCategory] = useState<ConditionCategory | ''>('')
  const [localConditions, setLocalConditions] = useState<Condition[]>(conditions)
  const [pendingRejection, setPendingRejection] = useState<{ id: string; reason: string } | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<{ template: ConditionTemplate; category: ConditionCategory | '' } | null>(null)

  const relevantTemplates = templates.filter(
    t => t.loan_type === null || t.loan_type === loanType
  )
  const alreadyAdded = new Set(localConditions.map(c => c.title))

  async function updateCategory(conditionId: string, category: ConditionCategory | '') {
    try {
      const res = await fetch('/api/admin/conditions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditionId, category: category || null }),
      })
      const data = await res.json()
      if (data.success) {
        setLocalConditions(prev =>
          prev.map(c => c.id === conditionId ? { ...c, category: (category || null) as ConditionCategory | null } : c)
        )
        toast.success('Category updated')
      } else {
        toast.error('Failed to update category')
      }
    } catch (err) {
      toast.error('Network error. Please try again.')
      console.error('updateCategory error:', err)
    }
  }

  async function addFromTemplate(template: ConditionTemplate, categoryOverride: ConditionCategory | '') {
    setSaving(true)
    const res = await fetch('/api/admin/conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanId,
        title: template.title,
        description: template.description,
        assignedTo: template.assigned_to ?? 'borrower',
        category: categoryOverride || template.category || null,
      }),
    })
    const data = await res.json()
    if (data.success) {
      setLocalConditions(prev => [...prev, data.condition as Condition])
      setPendingTemplate(null)
      toast.success('Condition added')
    } else {
      toast.error('Failed to add condition: ' + (data.error ?? 'Unknown error'))
    }
    setSaving(false)
  }

  async function addCustom() {
    if (!newTitle.trim()) return
    setSaving(true)
    const res = await fetch('/api/admin/conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanId,
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        assignedTo: newAssignedTo,
        category: newCategory || null,
      }),
    })
    const data = await res.json()
    if (data.success) {
      setLocalConditions(prev => [...prev, data.condition as Condition])
      setNewTitle('')
      setNewDescription('')
      setNewAssignedTo('borrower')
      setNewCategory('')
      toast.success('Condition added')
    } else {
      toast.error('Failed to add condition: ' + (data.error ?? 'Unknown error'))
    }
    setSaving(false)
  }

  async function updateStatus(conditionId: string, status: ConditionStatus) {
    if (status === 'Rejected') {
      setPendingRejection({ id: conditionId, reason: '' })
      return
    }

    try {
      const res = await fetch('/api/admin/conditions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditionId, status }),
      })
      const data = await res.json()
      if (data.success) {
        setLocalConditions(prev =>
          prev.map(c => c.id === conditionId ? { ...c, status, rejection_reason: null } : c)
        )
        toast.success(`Marked ${status}`)
      } else {
        toast.error('Failed to update status: ' + (data.error ?? 'Unknown error'))
      }
    } catch (err) {
      toast.error('Network error updating status. Please try again.')
      console.error('updateStatus error:', err)
    }
  }

  async function updateAssignedTo(conditionId: string, assignedTo: AssignedTo) {
    try {
      const res = await fetch('/api/admin/conditions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditionId, assignedTo }),
      })
      const data = await res.json()
      if (data.success) {
        setLocalConditions(prev =>
          prev.map(c => c.id === conditionId ? { ...c, assigned_to: assignedTo } : c)
        )
        toast.success(`Reassigned to ${assignedToLabel(assignedTo)}`)
      } else {
        toast.error('Failed to update assignment: ' + (data.error ?? 'Unknown error'))
      }
    } catch (err) {
      toast.error('Network error. Please try again.')
      console.error('updateAssignedTo error:', err)
    }
  }

  async function confirmRejection() {
    if (!pendingRejection) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/conditions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conditionId: pendingRejection.id,
          status: 'Rejected',
          rejectionReason: pendingRejection.reason.trim() || null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setLocalConditions(prev =>
          prev.map(c => c.id === pendingRejection.id
            ? { ...c, status: 'Rejected', rejection_reason: pendingRejection.reason.trim() || null }
            : c
          )
        )
        setPendingRejection(null)
        toast.success('Condition rejected')
      } else {
        toast.error('Failed to reject condition: ' + (data.error ?? 'Unknown error'))
      }
    } catch (err) {
      console.error('confirmRejection error:', err)
      toast.error('An error occurred. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCondition(conditionId: string) {
    const res = await fetch('/api/admin/conditions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId }),
    })
    const data = await res.json()
    if (data.success) {
      setLocalConditions(prev => prev.filter(c => c.id !== conditionId))
      toast.success('Condition removed')
    } else {
      toast.error('Failed to remove condition')
    }
  }

  return (
    <div className="space-y-4">
      {/* Current Conditions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Conditions
            <span className="ml-2 text-sm font-normal text-gray-500">
              {localConditions.filter(c => c.status !== 'Satisfied' && c.status !== 'Waived' && c.status !== 'Received').length} outstanding
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Hidden file input shared across all conditions */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.xlsx,.xls,.csv"
          />

          {localConditions.length === 0 ? (
            <p className="text-sm text-gray-500">No conditions yet. Add from templates below or create a custom one.</p>
          ) : (
            <div className="space-y-4">
              {[...CONDITION_CATEGORIES, null].map(cat => {
                const catValue = cat ? cat.value : null
                const catLabel = cat ? cat.label : 'Uncategorized'
                const group = localConditions.filter(c => (c.category ?? null) === catValue)
                if (group.length === 0) return null
                return (
                  <div key={catValue ?? 'uncategorized'}>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{catLabel}</p>
                    <div className="space-y-2">
                      {group.map(condition => (
                        <div key={condition.id}>
                          <div className="flex items-center gap-3 border rounded-lg p-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{condition.title}</p>
                              {condition.description && (
                                <p className="text-xs text-gray-500 truncate">{condition.description}</p>
                              )}
                              {condition.status === 'Rejected' && condition.rejection_reason && (
                                <p className="text-xs text-red-600 mt-0.5">Reason: {condition.rejection_reason}</p>
                              )}
                            </div>
                            <button
                              onClick={() => triggerUpload(condition.id, condition.title)}
                              disabled={uploadingSet.has(condition.id)}
                              title="Upload document(s) for this condition"
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary transition-colors disabled:opacity-50 shrink-0"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              {uploadingSet.has(condition.id) ? 'Uploading…' : 'Upload'}
                            </button>
                            {/* Category dropdown */}
                            <select
                              value={condition.category ?? ''}
                              onChange={(e) => updateCategory(condition.id, e.target.value as ConditionCategory | '')}
                              className="text-xs px-2 py-1 rounded border border-gray-200 bg-white cursor-pointer text-gray-600"
                            >
                              <option value="">Uncategorized</option>
                              {CONDITION_CATEGORIES.map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                            {/* Assigned-to toggle */}
                            <select
                              value={condition.assigned_to ?? 'borrower'}
                              onChange={(e) => updateAssignedTo(condition.id, e.target.value as AssignedTo)}
                              className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${assignedToColor(condition.assigned_to ?? 'borrower')}`}
                            >
                              <option value="borrower">Borrower</option>
                              <option value="loan_officer">Loan Officer</option>
                              <option value="loan_processor">Loan Processor</option>
                            </select>
                            {/* Status dropdown */}
                            <select
                              value={condition.status}
                              onChange={(e) => updateStatus(condition.id, e.target.value as ConditionStatus)}
                              className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${statusColor(condition.status)}`}
                            >
                              {STATUS_OPTIONS.map(s => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => deleteCondition(condition.id)}
                              className="text-gray-400 hover:text-red-500 text-xs ml-1"
                              title="Remove condition"
                            >
                              ✕
                            </button>
                          </div>
                          {/* Rejection reason input */}
                          {pendingRejection?.id === condition.id && (
                            <div className="border border-red-200 rounded-lg p-3 mt-1 bg-red-50 space-y-2">
                              <p className="text-xs font-medium text-red-700">Rejection reason (shown to borrower)</p>
                              <Input
                                placeholder="e.g. Document is illegible, please re-upload a clearer copy."
                                value={pendingRejection.reason}
                                onChange={e => setPendingRejection({ ...pendingRejection, reason: e.target.value })}
                                className="text-sm"
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={confirmRejection} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white">
                                  Confirm Rejection
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setPendingRejection(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Custom Condition */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Custom Condition</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Condition title (e.g. Proof of Insurance)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <Input
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500">Assigned to:</span>
            {(['borrower', 'loan_officer', 'loan_processor'] as AssignedTo[]).map(opt => (
              <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-sm">
                <input type="radio" name="assignedTo" value={opt} checked={newAssignedTo === opt} onChange={() => setNewAssignedTo(opt)} />
                {opt === 'borrower' ? 'Borrower' : opt === 'loan_officer' ? 'Loan Officer' : 'Loan Processor'}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">Category:</span>
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value as ConditionCategory | '')}
              className="text-sm px-2 py-1.5 rounded border border-gray-200 bg-white text-gray-700"
            >
              <option value="">Uncategorized</option>
              {CONDITION_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <Button onClick={addCustom} disabled={saving || !newTitle.trim()} size="sm">
            Add Condition
          </Button>
        </CardContent>
      </Card>

      {/* Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Add from Templates
            <span className="ml-2 text-sm font-normal text-gray-500">
              Showing universal + {loanType ?? 'all'} templates
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {relevantTemplates.map(template => {
              const added = alreadyAdded.has(template.title)
              const isPending = pendingTemplate?.template.id === template.id
              return (
                <div key={template.id} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{template.title}</p>
                      {template.description && (
                        <p className="text-xs text-gray-500 truncate">{template.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        {template.loan_type && (
                          <span className="text-xs text-primary">{template.loan_type}</span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${assignedToColor(template.assigned_to ?? 'borrower')}`}>
                          {assignedToLabel(template.assigned_to ?? 'borrower')}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={added ? 'outline' : isPending ? 'outline' : 'default'}
                      disabled={saving || added}
                      onClick={() => isPending
                        ? setPendingTemplate(null)
                        : setPendingTemplate({ template, category: template.category ?? '' })
                      }
                      className="shrink-0"
                    >
                      {added ? 'Added' : isPending ? 'Cancel' : '+ Add'}
                    </Button>
                  </div>

                  {/* Inline category picker */}
                  {isPending && (
                    <div className="border-t bg-gray-50 px-3 py-3 flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Category:</span>
                      <select
                        value={pendingTemplate.category}
                        onChange={e => setPendingTemplate({ ...pendingTemplate, category: e.target.value as ConditionCategory | '' })}
                        className="text-sm px-2 py-1.5 rounded border border-gray-200 bg-white text-gray-700"
                      >
                        <option value="">Uncategorized</option>
                        {CONDITION_CATEGORIES.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={() => addFromTemplate(pendingTemplate.template, pendingTemplate.category)}
                      >
                        {saving ? 'Adding...' : 'Confirm Add'}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
