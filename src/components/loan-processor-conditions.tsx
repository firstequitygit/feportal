'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type Condition, type Document, type ConditionStatus, type AssignedTo, type ConditionCategory, type ConditionTemplate, CONDITION_CATEGORIES } from '@/lib/types'
import { BulkActionBar, BulkActionButton } from '@/components/bulk-action-bar'
import { CollapsibleCard } from '@/components/collapsible-card'
import { DocumentPreviewLink } from '@/components/document-preview-link'

interface Props {
  loanId: string
  loanType?: string | null
  propertyAddress: string | null
  conditions: Condition[]
  documents: Document[]
  signedUrlMap: Record<string, string>
  templates?: ConditionTemplate[]
}

function statusColor(status: ConditionStatus): string {
  switch (status) {
    case 'Outstanding': return 'bg-red-100 text-red-700'
    case 'Received':    return 'bg-yellow-100 text-yellow-700'
    case 'Satisfied':   return 'bg-green-100 text-green-700'
    case 'Waived':      return 'bg-gray-100 text-gray-500'
    case 'Rejected':    return 'bg-red-100 text-red-800'
  }
}


function assignedToLabel(assigned_to: AssignedTo): string {
  switch (assigned_to) {
    case 'loan_officer':   return 'Loan Officer'
    case 'loan_processor': return 'Loan Processor'
    default:               return 'Borrower'
  }
}

function assignedToColor(assigned_to: AssignedTo): string {
  switch (assigned_to) {
    case 'loan_officer':   return 'bg-blue-100 text-blue-700'
    case 'loan_processor': return 'bg-purple-100 text-purple-700'
    default:               return 'bg-gray-100 text-gray-500'
  }
}

const CHANGEABLE_STATUSES: ConditionStatus[] = ['Outstanding', 'Received', 'Rejected', 'Waived']

function ConditionRow({
  condition, docs, signedUrlMap, canUpload, uploading, selected, selectable, onToggleSelect, onUpload, fileRef, onDeleteDoc, onSaveResponse, onChangeStatus, onChangeCategory,
}: {
  condition: Condition
  docs: Document[]
  signedUrlMap: Record<string, string>
  canUpload: boolean
  uploading: boolean
  selected: boolean
  selectable: boolean
  onToggleSelect: () => void
  onUpload: (files: FileList) => void
  fileRef: (el: HTMLInputElement | null) => void
  onDeleteDoc: (docId: string, fileName: string) => Promise<void>
  onSaveResponse: (conditionId: string, response: string) => Promise<void>
  onChangeStatus: (conditionId: string, status: ConditionStatus, rejectionReason?: string) => Promise<void>
  onChangeCategory: (conditionId: string, category: ConditionCategory | null) => Promise<void>
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replySaving, setReplySaving] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [pendingRejection, setPendingRejection] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const faded = condition.status === 'Satisfied' || condition.status === 'Waived'

  async function handleDelete(docId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return
    setDeletingId(docId)
    await onDeleteDoc(docId, fileName)
    setDeletingId(null)
  }

  async function handleSubmitReply() {
    if (!replyText.trim()) return
    setReplySaving(true)
    await onSaveResponse(condition.id, replyText)
    setReplySaving(false)
    setShowReply(false)
    setReplyText('')
  }

  async function handleStatusSelect(newStatus: ConditionStatus) {
    if (newStatus === condition.status) return
    if (newStatus === 'Rejected') { setPendingRejection(true); return }
    setStatusChanging(true)
    await onChangeStatus(condition.id, newStatus)
    setStatusChanging(false)
  }

  async function handleConfirmRejection() {
    setStatusChanging(true)
    await onChangeStatus(condition.id, 'Rejected', rejectionReason)
    setStatusChanging(false)
    setPendingRejection(false)
    setRejectionReason('')
  }

  return (
    <div className={`border rounded-lg p-4 ${faded ? 'opacity-60' : ''} ${selected ? 'bg-primary/5 border-primary/40' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected}
              disabled={!selectable}
              onChange={onToggleSelect}
              className="accent-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              aria-label={`Select ${condition.title}`}
            />
            <p className="font-medium text-gray-900 text-sm">{condition.title}</p>
          </div>
          {condition.description && (
            <p className="text-xs text-gray-500 mt-1">{condition.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-gray-400">Category:</span>
            <select
              value={condition.category ?? ''}
              onChange={(e) => onChangeCategory(condition.id, (e.target.value || null) as ConditionCategory | null)}
              className="text-xs text-gray-600 bg-transparent border border-transparent hover:border-gray-200 rounded cursor-pointer focus:outline-none focus:border-gray-300 px-1.5 py-0.5"
              title="Change category"
            >
              <option value="">Uncategorized</option>
              {CONDITION_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          {condition.status === 'Rejected' && condition.rejection_reason && (
            <p className="text-xs text-red-600 mt-1 font-medium">⚠ Rejected: {condition.rejection_reason}</p>
          )}
          {condition.response && (
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded px-3 py-2">
              <p className="text-xs text-gray-500 font-medium mb-0.5">Text response</p>
              <p className="text-xs text-gray-800">{condition.response}</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${assignedToColor(condition.assigned_to)}`}>
            {assignedToLabel(condition.assigned_to)}
          </span>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${statusColor(condition.status)}`}>
            {condition.status}
          </span>
        </div>
      </div>

      {/* Status changer — not available for Satisfied */}
      {condition.status !== 'Satisfied' && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={condition.status}
            onChange={e => handleStatusSelect(e.target.value as ConditionStatus)}
            disabled={statusChanging || pendingRejection}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600 disabled:opacity-50"
          >
            {CHANGEABLE_STATUSES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {statusChanging && <span className="text-xs text-gray-400">Saving…</span>}
        </div>
      )}

      {/* Rejection reason prompt */}
      {pendingRejection && (
        <div className="mt-2 space-y-2">
          <textarea
            value={rejectionReason}
            onChange={e => setRejectionReason(e.target.value)}
            placeholder="Reason for rejection (optional)…"
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <div className="flex gap-2">
            <button onClick={handleConfirmRejection} disabled={statusChanging}
              className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50">
              {statusChanging ? 'Saving…' : 'Confirm Rejection'}
            </button>
            <button onClick={() => { setPendingRejection(false); setRejectionReason('') }}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {docs.map(doc => {
            const url = signedUrlMap[doc.id]
            return (
              <div key={doc.id} className="flex items-center gap-2 text-xs">
                <span>📄</span>
                {url ? (
                  <DocumentPreviewLink url={url} fileName={doc.file_name} />
                ) : (
                  <span className="text-gray-600">{doc.file_name}</span>
                )}
                <button onClick={() => handleDelete(doc.id, doc.file_name)} disabled={deletingId === doc.id}
                  className="ml-1 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50" title="Delete document">
                  {deletingId === doc.id ? '…' : '✕'}
                </button>
              </div>
            )
          })}
        </div>
      )}
      {canUpload && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div>
            <input ref={fileRef} type="file" multiple className="hidden"
              onChange={(e) => { if (e.target.files?.length) onUpload(e.target.files) }} />
            <button
              onClick={(e) => {
                const input = e.currentTarget.previousElementSibling as HTMLInputElement
                if (input) { input.multiple = true; input.click() }
              }}
              disabled={uploading}
              className="text-xs text-primary hover:opacity-80 disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : '+ Upload document(s)'}
            </button>
          </div>
          {!showReply && (
            <button onClick={() => setShowReply(true)} className="text-xs text-gray-500 hover:text-primary">
              + Text response
            </button>
          )}
        </div>
      )}
      {showReply && (
        <div className="mt-3 space-y-2">
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Type your response here…"
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmitReply}
              disabled={replySaving || !replyText.trim()}
              className="text-xs bg-primary text-white px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {replySaving ? 'Saving…' : 'Submit Response'}
            </button>
            <button onClick={() => { setShowReply(false); setReplyText('') }}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function LoanProcessorConditions({ loanId, loanType, propertyAddress, conditions, documents, signedUrlMap, templates = [] }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [uploadingSet, setUploadingSet] = useState<Set<string>>(new Set())
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const [adding, setAdding] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addDescription, setAddDescription] = useState('')
  const [addAssignedTo, setAddAssignedTo] = useState<AssignedTo>('borrower')
  const [addCategory, setAddCategory] = useState<ConditionCategory | ''>('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  function getDocsForCondition(conditionId: string): Document[] {
    return documents.filter(d => d.condition_id === conditionId)
  }

  async function handleSaveResponse(conditionId: string, response: string) {
    const res = await fetch('/api/loan-processor/conditions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId, response }),
    })
    const data = await res.json()
    if (data.success) {
      router.refresh()
    } else {
      setAddError(data.error ?? 'Failed to save response')
    }
  }

  async function handleChangeCategory(conditionId: string, category: ConditionCategory | null) {
    const res = await fetch('/api/conditions/category', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId, category }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      router.refresh()
    } else {
      setAddError(data.error ?? 'Failed to change category')
    }
  }

  async function handleChangeStatus(conditionId: string, status: ConditionStatus, rejectionReason?: string) {
    const res = await fetch('/api/loan-processor/conditions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId, status, rejectionReason }),
    })
    const data = await res.json()
    if (data.success) {
      router.refresh()
    } else {
      setAddError(data.error ?? 'Failed to update status')
    }
  }

  async function handleDeleteDoc(docId: string, fileName: string) {
    setDeleteError(null)
    const res = await fetch('/api/documents', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: docId }),
    })
    const data = await res.json()
    if (data.success) {
      router.refresh()
    } else {
      setDeleteError(data.error ?? `Failed to delete "${fileName}"`)
    }
  }

  async function uploadSingleFile(conditionId: string, file: File, conditionTitle: string): Promise<boolean> {
    const signRes = await fetch('/api/loan-processor/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, conditionId, fileName: file.name, conditionTitle, propertyAddress }),
    })
    if (!signRes.ok) {
      const data = await signRes.json().catch(() => ({}))
      setUploadError(data.error ?? 'Could not start upload.')
      return false
    }
    const { path, token } = await signRes.json()
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .uploadToSignedUrl(path, token, file, { contentType: file.type || 'application/octet-stream' })
    if (uploadErr) { setUploadError(`"${file.name}" upload failed: ` + uploadErr.message); return false }
    const recordRes = await fetch('/api/loan-processor/upload/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, conditionId, fileName: file.name, fileSize: file.size, path }),
    })
    if (!recordRes.ok) {
      const data = await recordRes.json().catch(() => ({}))
      setUploadError(data.error ?? 'File uploaded but could not save record.')
      return false
    }
    return true
  }

  async function handleUpload(conditionId: string, files: FileList) {
    const fileArray = Array.from(files)
    if (!fileArray.length) return
    setUploadError(null)
    setUploadingSet(prev => new Set(prev).add(conditionId))
    const conditionTitle = conditions.find(c => c.id === conditionId)?.title ?? conditionId
    for (const file of fileArray) {
      const ok = await uploadSingleFile(conditionId, file, conditionTitle)
      if (!ok) break
    }
    setUploadingSet(prev => { const next = new Set(prev); next.delete(conditionId); return next })
    router.refresh()
  }

  async function handleAddCondition() {
    if (!addTitle.trim()) { setAddError('Title is required'); return }
    setAddSaving(true)
    setAddError(null)
    const res = await fetch('/api/loan-processor/conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanId,
        title: addTitle.trim(),
        description: addDescription.trim() || null,
        assignedTo: addAssignedTo,
        category: addCategory || null,
      }),
    })
    const data = await res.json()
    if (data.success) {
      setAdding(false)
      setAddTitle('')
      setAddDescription('')
      setAddCategory('')
      setAddAssignedTo('borrower')
      setAddSaving(false)
      router.refresh()
    } else {
      setAddError(data.error ?? 'Failed to add condition')
      setAddSaving(false)
    }
  }

  const [templateSaving, setTemplateSaving] = useState<string | null>(null) // template id being added
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [addedTemplates, setAddedTemplates] = useState<Set<string>>(new Set(conditions.map(c => c.title)))

  const relevantTemplates = templates.filter(t => t.loan_type === null || t.loan_type === loanType)

  const [selectedConditions, setSelectedConditions] = useState<Set<string>>(new Set())
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  function toggleConditionSelection(id: string) {
    setSelectedConditions(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleTemplateSelection(id: string) {
    setSelectedTemplates(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleBulkStatus(status: 'Received' | 'Waived') {
    const ids = Array.from(selectedConditions)
    if (ids.length === 0) return
    setBulkSaving(true); setBulkError(null)
    const results = await Promise.all(ids.map(id =>
      fetch('/api/loan-processor/conditions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditionId: id, status }),
      }).then(r => r.json()).catch(() => ({ success: false }))
    ))
    const failed = results.filter(r => !r.success).length
    if (failed > 0) setBulkError(`${failed} of ${ids.length} failed`)
    setSelectedConditions(new Set())
    setBulkSaving(false)
    router.refresh()
  }

  async function handleBulkAddTemplates() {
    const ids = Array.from(selectedTemplates)
    if (ids.length === 0) return
    const toAdd = relevantTemplates.filter(t => ids.includes(t.id) && !addedTemplates.has(t.title))
    if (toAdd.length === 0) { setSelectedTemplates(new Set()); return }
    setBulkSaving(true); setTemplateError(null)
    const results = await Promise.all(toAdd.map(template =>
      fetch('/api/loan-processor/conditions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanId,
          title: template.title,
          description: template.description ?? null,
          assignedTo: template.assigned_to ?? 'borrower',
          category: template.category ?? null,
        }),
      }).then(r => r.json()).catch(() => ({ success: false }))
    ))
    const failed = results.filter(r => !r.success).length
    setAddedTemplates(prev => {
      const next = new Set(prev)
      results.forEach((r, i) => { if (r.success) next.add(toAdd[i].title) })
      return next
    })
    if (failed > 0) setTemplateError(`${failed} of ${toAdd.length} failed`)
    setSelectedTemplates(new Set())
    setBulkSaving(false)
    router.refresh()
  }

  async function handleAddFromTemplate(template: ConditionTemplate) {
    setTemplateSaving(template.id)
    setTemplateError(null)
    const res = await fetch('/api/loan-processor/conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanId,
        title: template.title,
        description: template.description ?? null,
        assignedTo: template.assigned_to ?? 'borrower',
        category: template.category ?? null,
      }),
    })
    const data = await res.json()
    if (data.success) {
      setAddedTemplates(prev => new Set(prev).add(template.title))
      router.refresh()
    } else {
      setTemplateError(data.error ?? 'Failed to add condition')
    }
    setTemplateSaving(null)
  }

  // Group conditions by category
  const grouped = [...CONDITION_CATEGORIES, null].map(cat => {
    const catValue = cat ? cat.value : null
    const catLabel = cat ? cat.label : 'Uncategorized'
    const group = conditions.filter(c => (c.category ?? null) === catValue)
    return { catValue, catLabel, group }
  }).filter(g => g.group.length > 0)

  return (
    <div className="space-y-4">
      {uploadError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{uploadError}</p>}
      {deleteError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{deleteError}</p>}

      {/* Add Condition card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Conditions</CardTitle>
          {!adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-primary hover:opacity-80 font-medium">
              + Add Condition
            </button>
          )}
        </CardHeader>
        {adding && (
          <CardContent className="pt-0 space-y-3">
            <Input placeholder="Condition title *" value={addTitle} onChange={e => setAddTitle(e.target.value)} />
            <Input placeholder="Description (optional)" value={addDescription} onChange={e => setAddDescription(e.target.value)} />
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 font-medium">Category</p>
              <select
                value={addCategory}
                onChange={e => setAddCategory(e.target.value as ConditionCategory | '')}
                className="w-full text-sm px-3 py-2 rounded border border-gray-200 bg-white text-gray-700"
              >
                <option value="">Uncategorized</option>
                {CONDITION_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 font-medium">Assign to</p>
              <div className="flex gap-4">
                {(['borrower', 'loan_officer', 'loan_processor'] as AssignedTo[]).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="lp-assign" value={opt} checked={addAssignedTo === opt}
                      onChange={() => setAddAssignedTo(opt)} className="accent-primary" />
                    {opt === 'borrower' ? 'Borrower' : opt === 'loan_officer' ? 'Loan Officer' : 'Loan Processor'}
                  </label>
                ))}
              </div>
            </div>
            {addError && <p className="text-xs text-red-600">{addError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddCondition} disabled={addSaving}>
                {addSaving ? 'Adding...' : 'Add Condition'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setAddTitle(''); setAddDescription(''); setAddCategory(''); setAddError(null) }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Conditions grouped by category */}
      {grouped.map(({ catValue, catLabel, group }) => {
        const outstanding = group.filter(c => c.status === 'Outstanding' || c.status === 'Received').length
        return (
          <Card key={catValue ?? 'uncategorized'}>
            <CardHeader>
              <CardTitle className="text-base">
                {catLabel}
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {outstanding > 0 ? `${outstanding} outstanding` : 'all clear'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {group.map(condition => {
                const canUpload = condition.status === 'Outstanding' || condition.status === 'Received' || condition.status === 'Rejected'
                return (
                  <ConditionRow key={condition.id} condition={condition} docs={getDocsForCondition(condition.id)}
                    signedUrlMap={signedUrlMap} canUpload={canUpload} uploading={uploadingSet.has(condition.id)}
                    selected={selectedConditions.has(condition.id)}
                    selectable={condition.status !== 'Satisfied' && condition.status !== 'Waived'}
                    onToggleSelect={() => toggleConditionSelection(condition.id)}
                    onUpload={(files) => handleUpload(condition.id, files)}
                    fileRef={(el) => { fileInputRefs.current[condition.id] = el }}
                    onDeleteDoc={handleDeleteDoc}
                    onSaveResponse={handleSaveResponse}
                    onChangeStatus={handleChangeStatus}
                    onChangeCategory={handleChangeCategory} />
                )
              })}
            </CardContent>
          </Card>
        )
      })}

      {conditions.length === 0 && !adding && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-gray-500">No conditions have been added to this loan yet.</p>
          </CardContent>
        </Card>
      )}

      {/* Add from Templates */}
      {relevantTemplates.length > 0 && (
        <CollapsibleCard
          title={
            <>
              Add from Templates
              <span className="ml-2 text-sm font-normal text-gray-500">
                {loanType ? `Universal + ${loanType}` : 'Universal templates'}
              </span>
            </>
          }
        >
            {templateError && (
              <p className="text-xs text-red-600 mb-3">{templateError}</p>
            )}
            {(() => {
              const selectableCount = relevantTemplates.filter(t => selectedTemplates.has(t.id) && !addedTemplates.has(t.title)).length
              if (selectableCount === 0) return null
              return (
                <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-gray-100">
                  <p className="text-sm text-gray-700">
                    {selectableCount} template{selectableCount === 1 ? '' : 's'} selected
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedTemplates(new Set())}
                      disabled={bulkSaving}
                      className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                    >
                      Clear
                    </button>
                    <Button size="sm" onClick={handleBulkAddTemplates} disabled={bulkSaving}>
                      {bulkSaving ? 'Adding…' : `+ Add ${selectableCount} selected`}
                    </Button>
                  </div>
                </div>
              )
            })()}
            <div className="space-y-2">
              {relevantTemplates.map(template => {
                const alreadyAdded = addedTemplates.has(template.title)
                const isSaving = templateSaving === template.id
                const isSelected = selectedTemplates.has(template.id)
                return (
                  <div key={template.id} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border rounded-lg p-3 ${isSelected && !alreadyAdded ? 'bg-primary/5 border-primary/40' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isSelected && !alreadyAdded}
                      disabled={alreadyAdded || bulkSaving}
                      onChange={() => toggleTemplateSelection(template.id)}
                      className="accent-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      aria-label={`Select template ${template.title}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{template.title}</p>
                      {template.description && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{template.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
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
                      variant={alreadyAdded ? 'outline' : 'default'}
                      disabled={alreadyAdded || isSaving || !!templateSaving || bulkSaving}
                      onClick={() => handleAddFromTemplate(template)}
                      className="shrink-0"
                    >
                      {alreadyAdded ? 'Added' : isSaving ? 'Adding…' : '+ Add'}
                    </Button>
                  </div>
                )
              })}
            </div>
        </CollapsibleCard>
      )}

      <BulkActionBar
        count={selectedConditions.size}
        onClear={() => setSelectedConditions(new Set())}
        saving={bulkSaving}
        error={bulkError}
      >
        <BulkActionButton onClick={() => handleBulkStatus('Received')} disabled={bulkSaving}>
          ◑ Mark Received
        </BulkActionButton>
        <BulkActionButton onClick={() => handleBulkStatus('Waived')} disabled={bulkSaving}>
          — Waive
        </BulkActionButton>
      </BulkActionBar>
    </div>
  )
}
