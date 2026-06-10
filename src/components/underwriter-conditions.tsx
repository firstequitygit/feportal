'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type Condition, type Document, type ConditionStatus, type AssignedTo, type ConditionCategory, type ConditionTemplate, CONDITION_CATEGORIES } from '@/lib/types'
import { BulkActionBar, BulkActionButton } from '@/components/bulk-action-bar'
import { CollapsibleCard } from '@/components/collapsible-card'
import { DocumentPreviewLink } from '@/components/document-preview-link'
import { ConditionNotes, type ConditionNote } from '@/components/condition-notes'
import { useImpersonation } from '@/components/impersonation-provider'
import { BulkUploadModal, type BulkDoc } from '@/components/bulk-upload-modal'
import { UnmatchedDocumentsCard, type UnmatchedDoc } from '@/components/unmatched-documents-card'
import { suggestConditionId } from '@/lib/match-condition'
import { ConditionReminderButton } from '@/components/condition-reminder-button'
import { TemplateAssigneePicker } from '@/components/template-assignee-picker'

export interface LoanStaffSummary {
  loan_officer?: { id: string; full_name: string } | null
  loan_processor?: { id: string; full_name: string } | null
  loan_processor_2?: { id: string; full_name: string } | null
  underwriter?: { id: string; full_name: string } | null
}

export interface StaffDirectorySummary {
  loan_officers: Array<{ id: string; full_name: string }>
  loan_processors: Array<{ id: string; full_name: string }>
  underwriters: Array<{ id: string; full_name: string }>
}

interface Props {
  loanId: string
  loanType?: string | null
  propertyAddress: string | null
  conditions: Condition[]
  documents: Document[]
  signedUrlMap: Record<string, string>   // doc.id → signed download URL
  templates?: ConditionTemplate[]
  loanStaff?: LoanStaffSummary
  staffDirectory?: StaffDirectorySummary
  notesByCondition?: Record<string, ConditionNote[]>
  mentionableStaff?: import('@/lib/mentionable-staff').MentionableUser[]
  /** True if the loan has any borrower or broker slot filled — drives
      the Send Reminder button. Server picks the actual recipient
      party (broker wins). */
  hasReminderRecipient?: boolean
}

function statusColor(status: ConditionStatus): string {
  switch (status) {
    case 'Outstanding':  return 'bg-red-100 text-red-700'
    case 'Received':     return 'bg-yellow-100 text-yellow-700'
    case 'Under Review': return 'bg-blue-100 text-blue-700'
    case 'Satisfied':    return 'bg-green-100 text-green-700'
    case 'Waived':       return 'bg-gray-100 text-gray-500'
    case 'Rejected':     return 'bg-red-100 text-red-800'
  }
}


function assignedToLabel(assigned_to: AssignedTo): string {
  switch (assigned_to) {
    case 'loan_officer':   return 'Loan Officer'
    case 'loan_processor': return 'Loan Processor'
    case 'underwriter':    return 'Underwriter'
    case 'closer':         return 'Closer'
    default:               return 'Borrower'
  }
}

function assignedToColor(assigned_to: AssignedTo): string {
  switch (assigned_to) {
    case 'loan_officer':   return 'bg-blue-100 text-blue-700'
    case 'loan_processor': return 'bg-purple-100 text-purple-700'
    case 'underwriter':    return 'bg-orange-100 text-orange-700'
    case 'closer':         return 'bg-amber-100 text-amber-700'
    default:               return 'bg-gray-100 text-gray-500'
  }
}

function ConditionRow({
  condition, docs, signedUrlMap, canUpload, uploading, selected, selectable, loanStaff, staffDirectory, notes, isImpersonating, mentionableStaff, onToggleSelect, onUpload, fileRef, onUpdateStatus, onDeleteDoc, onDeleteCondition, onChangeCategory, onReassign, onToggleUrgent,
}: {
  condition: Condition
  docs: Document[]
  signedUrlMap: Record<string, string>
  canUpload: boolean
  uploading: boolean
  selected: boolean
  selectable: boolean
  loanStaff?: LoanStaffSummary
  staffDirectory?: StaffDirectorySummary
  notes?: ConditionNote[]
  onToggleSelect: () => void
  onUpload: (files: FileList) => void
  fileRef: (el: HTMLInputElement | null) => void
  onUpdateStatus: (conditionId: string, status: 'Outstanding' | 'Satisfied' | 'Rejected' | 'Waived' | 'Under Review', rejectionReason?: string) => Promise<void>
  onDeleteDoc: (docId: string, fileName: string) => Promise<void>
  onDeleteCondition: (conditionId: string, title: string) => Promise<void>
  onChangeCategory: (conditionId: string, category: ConditionCategory | null) => Promise<void>
  onReassign: (conditionId: string, assignedTo: AssignedTo) => Promise<void>
  onToggleUrgent: (conditionId: string, isUrgent: boolean) => Promise<void>
  isImpersonating: boolean
  mentionableStaff?: import('@/lib/mentionable-staff').MentionableUser[]
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingCondition, setDeletingCondition] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [updating, setUpdating] = useState(false)
  // Satisfied cards start minimized — the work is done, so the full
  // card (docs, notes, review buttons) is collapsed to one line until
  // expanded.
  const [expanded, setExpanded] = useState(false)

  const faded = condition.status === 'Satisfied' || condition.status === 'Waived'
  // Underwriters can revisit any condition at any time — even ones previously
  // satisfied or waived — so the Review buttons should always be available.
  const canReview = true

  async function handleDeleteDoc(docId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return
    setDeletingId(docId)
    await onDeleteDoc(docId, fileName)
    setDeletingId(null)
  }

  async function handleDeleteCondition() {
    if (!confirm(`Delete condition "${condition.title}"? This cannot be undone.`)) return
    setDeletingCondition(true)
    await onDeleteCondition(condition.id, condition.title)
    setDeletingCondition(false)
  }

  async function handleSatisfy() {
    setUpdating(true)
    await onUpdateStatus(condition.id, 'Satisfied')
    setReviewing(false)
    setUpdating(false)
  }

  async function handleWaive() {
    setUpdating(true)
    await onUpdateStatus(condition.id, 'Waived')
    setReviewing(false)
    setUpdating(false)
  }

  async function handleReopen() {
    setUpdating(true)
    await onUpdateStatus(condition.id, 'Outstanding')
    setReviewing(false)
    setUpdating(false)
  }

  async function handleUnderReview() {
    setUpdating(true)
    await onUpdateStatus(condition.id, 'Under Review')
    setReviewing(false)
    setUpdating(false)
  }

  async function handleReject() {
    setUpdating(true)
    await onUpdateStatus(condition.id, 'Rejected', rejectionReason.trim() || undefined)
    setReviewing(false)
    setRejecting(false)
    setRejectionReason('')
    setUpdating(false)
  }

  // Minimized one-line view for Satisfied conditions.
  if (condition.status === 'Satisfied' && !expanded) {
    return (
      <div className={`border rounded-lg px-4 py-2 opacity-60 ${selected ? 'bg-primary/5 border-primary/40' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            disabled={!selectable}
            onChange={onToggleSelect}
            className="accent-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            aria-label={`Select ${condition.title}`}
          />
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex-1 min-w-0 text-left cursor-pointer"
            title="Expand condition details"
          >
            <span className="font-medium text-gray-900 text-sm truncate block">{condition.title}</span>
          </button>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 ${statusColor(condition.status)}`}>
            {condition.status}
          </span>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-gray-400 hover:text-gray-600 shrink-0"
            title="Expand condition details"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`border rounded-lg p-4 ${faded ? 'opacity-60' : ''} ${selected ? 'bg-primary/5 border-primary/40' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="checkbox"
              checked={selected}
              disabled={!selectable}
              onChange={onToggleSelect}
              className="accent-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              aria-label={`Select ${condition.title}`}
            />
            <p className="font-medium text-gray-900 text-sm">{condition.title}</p>
            {condition.is_urgent && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide uppercase bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                <span aria-hidden>🔥</span> Urgent
              </span>
            )}
          </div>
          {condition.description && (
            <p className="text-xs text-gray-500 mt-1">{condition.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-xs text-gray-400">Category:</span>
            <select
              value={condition.category ?? 'initial'}
              onChange={(e) => onChangeCategory(condition.id, e.target.value as ConditionCategory)}
              disabled={isImpersonating}
              className={`text-xs text-gray-600 bg-transparent border border-transparent hover:border-gray-200 rounded cursor-pointer focus:outline-none focus:border-gray-300 px-1.5 py-0.5 ${isImpersonating ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={isImpersonating ? 'Read-only preview — exit View As to act' : 'Change category'}
            >
              {CONDITION_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {/* Reassign — keeps the condition open but moves the next
                action to a different role. Resets the staff-name pin so
                a pinned UW name doesn't bleed into an LP assignment. */}
            <span className="text-xs text-gray-400 ml-2">Reassign:</span>
            <select
              value={condition.assigned_to}
              onChange={e => onReassign(condition.id, e.target.value as AssignedTo)}
              disabled={isImpersonating}
              className={`text-xs text-gray-600 bg-transparent border border-transparent hover:border-gray-200 rounded cursor-pointer focus:outline-none focus:border-gray-300 px-1.5 py-0.5 ${isImpersonating ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={isImpersonating ? 'Read-only preview — exit View As to act' : 'Reassign condition'}
            >
              <option value="borrower">Borrower</option>
              <option value="loan_officer">Loan Officer</option>
              <option value="loan_processor">Loan Processor</option>
              <option value="underwriter">Underwriter</option>
              <option value="closer">Closer</option>
            </select>
            <button
              type="button"
              onClick={isImpersonating ? undefined : () => onToggleUrgent(condition.id, !condition.is_urgent)}
              disabled={isImpersonating}
              className={`ml-2 text-xs px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${condition.is_urgent ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'} ${isImpersonating ? 'cursor-not-allowed' : ''}`}
              title={isImpersonating ? 'Read-only preview — exit View As to act' : (condition.is_urgent ? 'Remove urgent flag' : 'Mark urgent — notifies UW when received')}
            >
              {condition.is_urgent ? '🔥 Urgent' : 'Mark urgent'}
            </button>
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
            {(() => {
              if (condition.assigned_to_staff_id) {
                const onLoan =
                  condition.assigned_to === 'loan_officer'   ? [loanStaff?.loan_officer] :
                  condition.assigned_to === 'loan_processor' ? [loanStaff?.loan_processor, loanStaff?.loan_processor_2] :
                  condition.assigned_to === 'underwriter'    ? [loanStaff?.underwriter] :
                                                               []
                const onLoanMatch = onLoan.find(c => c && c.id === condition.assigned_to_staff_id)
                if (onLoanMatch) return onLoanMatch.full_name
                const directoryList =
                  condition.assigned_to === 'loan_officer'   ? staffDirectory?.loan_officers ?? [] :
                  condition.assigned_to === 'loan_processor' ? staffDirectory?.loan_processors ?? [] :
                  condition.assigned_to === 'underwriter'    ? staffDirectory?.underwriters ?? [] :
                                                               []
                const dirMatch = directoryList.find(c => c.id === condition.assigned_to_staff_id)
                if (dirMatch) return dirMatch.full_name
              }
              return assignedToLabel(condition.assigned_to)
            })()}
          </span>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${statusColor(condition.status)}`}>
            {condition.status}
          </span>
          {condition.status === 'Satisfied' && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-gray-400 hover:text-gray-600"
              title="Minimize"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={isImpersonating ? undefined : handleDeleteCondition}
            disabled={deletingCondition || isImpersonating}
            className={`text-gray-400 hover:text-red-500 text-xs ml-1 transition-colors disabled:opacity-50 ${isImpersonating ? 'cursor-not-allowed' : ''}`}
            title={isImpersonating ? 'Read-only preview — exit View As to act' : 'Remove condition'}
          >
            {deletingCondition ? '…' : '✕'}
          </button>
        </div>
      </div>

      {/* Documents — clickable links */}
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
                <button
                  onClick={() => handleDeleteDoc(doc.id, doc.file_name)}
                  disabled={deletingId === doc.id}
                  className="ml-1 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Delete document"
                >
                  {deletingId === doc.id ? '…' : '✕'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Review actions — shown when docs are present and condition is open.
          Admins impersonating an underwriter can act on conditions; the API
          recognizes the View-As cookie and applies the change as that UW. */}
      {canReview && (
        <div className="mt-3">
          {!reviewing ? (
            <button
              onClick={() => setReviewing(true)}
              className="text-xs font-medium text-primary hover:opacity-80"
            >
              Review condition →
            </button>
          ) : (
            <div className="space-y-2">
              {!rejecting ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" onClick={handleSatisfy} disabled={updating}
                    className="bg-green-600 hover:bg-green-700 text-white text-xs h-7 px-3">
                    {updating ? 'Saving…' : '✓ Satisfy'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={updating}
                    className="text-red-600 border-red-300 hover:bg-red-50 text-xs h-7 px-3">
                    ✕ Reject
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleUnderReview} disabled={updating}
                    className="text-blue-600 border-blue-300 hover:bg-blue-50 text-xs h-7 px-3">
                    ⏳ Under Review
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleWaive} disabled={updating}
                    className="text-gray-500 border-gray-300 hover:bg-gray-50 text-xs h-7 px-3">
                    — Waive
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleReopen} disabled={updating}
                    className="text-orange-600 border-orange-300 hover:bg-orange-50 text-xs h-7 px-3">
                    ↻ Reopen
                  </Button>
                  <button onClick={() => setReviewing(false)} className="text-xs text-gray-400 hover:text-gray-600 ml-1">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="Reason for rejection (optional)"
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    className="text-xs h-8"
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleReject} disabled={updating}
                      className="bg-red-600 hover:bg-red-700 text-white text-xs h-7 px-3">
                      {updating ? 'Saving…' : 'Confirm Reject'}
                    </Button>
                    <button onClick={() => { setRejecting(false); setRejectionReason('') }}
                      className="text-xs text-gray-400 hover:text-gray-600">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Upload */}
      {canUpload && !isImpersonating && (
        <div className="mt-3">
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
      )}

      <ConditionNotes conditionId={condition.id} initialNotes={notes ?? []} isImpersonating={isImpersonating} mentionableStaff={mentionableStaff} />
    </div>
  )
}

export function UnderwriterConditions({ loanId, loanType, propertyAddress, conditions, documents, signedUrlMap, templates = [], loanStaff, staffDirectory, notesByCondition, mentionableStaff, hasReminderRecipient }: Props) {
  const router = useRouter()
  const { isImpersonating } = useImpersonation()
  const supabase = createClient()
  const [uploadingSet, setUploadingSet] = useState<Set<string>>(new Set())
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const [adding, setAdding] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addDescription, setAddDescription] = useState('')
  const [addAssignedTo, setAddAssignedTo] = useState<AssignedTo | 'other'>('borrower')
  const [addAssignedToStaffId, setAddAssignedToStaffId] = useState<string>('')
  const [addCategory, setAddCategory] = useState<ConditionCategory>('initial')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkInitialDocs, setBulkInitialDocs] = useState<BulkDoc[] | undefined>(undefined)
  const [unmatchedRefreshKey, setUnmatchedRefreshKey] = useState(0)

  const [templateSaving, setTemplateSaving] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [addedTemplates, setAddedTemplates] = useState<Set<string>>(new Set(conditions.map(c => c.title)))
  // Per-template assignee override. Bulk + single add read this map.
  const [templateAssigneeOverrides, setTemplateAssigneeOverrides] = useState<Record<string, AssignedTo>>({})

  const [selectedConditions, setSelectedConditions] = useState<Set<string>>(new Set())
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const relevantTemplates = templates.filter(t => t.loan_type === null || t.loan_type === loanType)

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

  async function handleBulkStatus(status: 'Satisfied' | 'Waived') {
    const ids = Array.from(selectedConditions)
    if (ids.length === 0) return
    setBulkSaving(true); setBulkError(null)
    const results = await Promise.all(ids.map(id =>
      fetch('/api/underwriter/conditions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditionId: id, status, rejectionReason: null }),
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
      fetch('/api/underwriter/conditions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanId,
          title: template.title,
          description: template.description ?? null,
          assignedTo: templateAssigneeOverrides[template.id] ?? template.assigned_to ?? 'borrower',
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
    const res = await fetch('/api/underwriter/conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanId,
        title: template.title,
        description: template.description ?? null,
        assignedTo: templateAssigneeOverrides[template.id] ?? template.assigned_to ?? 'borrower',
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

  function getDocsForCondition(conditionId: string): Document[] {
    return documents.filter(d => d.condition_id === conditionId)
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

  async function handleDeleteCondition(conditionId: string, title: string) {
    setDeleteError(null)
    const res = await fetch('/api/underwriter/conditions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId }),
    })
    const data = await res.json()
    if (data.success) {
      router.refresh()
    } else {
      setDeleteError(data.error ?? `Failed to delete "${title}"`)
    }
  }

  async function handleChangeCategory(conditionId: string, category: ConditionCategory | null) {
    setUpdateError(null)
    const res = await fetch('/api/conditions/category', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId, category }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      router.refresh()
    } else {
      setUpdateError(data.error ?? 'Failed to change category')
    }
  }

  async function handleReassign(conditionId: string, assignedTo: AssignedTo) {
    setUpdateError(null)
    const res = await fetch('/api/conditions/assign', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId, assignedTo }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      router.refresh()
    } else {
      setUpdateError(data.error ?? 'Failed to reassign condition')
    }
  }

  async function handleToggleUrgent(conditionId: string, isUrgent: boolean) {
    setUpdateError(null)
    const res = await fetch('/api/conditions/urgency', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId, isUrgent }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      router.refresh()
    } else {
      setUpdateError(data.error ?? 'Failed to update urgency')
    }
  }

  async function handleUpdateStatus(conditionId: string, status: 'Outstanding' | 'Satisfied' | 'Rejected' | 'Waived' | 'Under Review', rejectionReason?: string) {
    setUpdateError(null)
    const res = await fetch('/api/underwriter/conditions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId, status, rejectionReason: rejectionReason ?? null }),
    })
    const data = await res.json()
    if (data.success) {
      router.refresh()
    } else {
      setUpdateError(data.error ?? 'Failed to update condition')
    }
  }

  async function uploadOneToStorage(
    conditionId: string,
    file: File,
    conditionTitle: string,
  ): Promise<{ fileName: string; fileSize: number; path: string } | null> {
    const signRes = await fetch('/api/underwriter/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, conditionId, fileName: file.name, conditionTitle, propertyAddress }),
    })
    if (!signRes.ok) { const d = await signRes.json().catch(() => ({})); setUploadError(d.error ?? 'Could not start upload.'); return null }
    const { path, token } = await signRes.json()
    const { error: uploadErr } = await supabase.storage.from('documents').uploadToSignedUrl(path, token, file, { contentType: file.type || 'application/octet-stream' })
    if (uploadErr) { setUploadError(`"${file.name}" upload failed: ` + uploadErr.message); return null }
    return { fileName: file.name, fileSize: file.size, path }
  }

  async function handleUpload(conditionId: string, files: FileList) {
    const fileArray = Array.from(files)
    if (!fileArray.length) return
    setUploadError(null)
    setUploadingSet(prev => new Set(prev).add(conditionId))
    const conditionTitle = conditions.find(c => c.id === conditionId)?.title ?? conditionId

    const uploaded: Array<{ fileName: string; fileSize: number; path: string }> = []
    for (const file of fileArray) {
      const result = await uploadOneToStorage(conditionId, file, conditionTitle)
      if (!result) break
      uploaded.push(result)
    }

    if (uploaded.length > 0) {
      const recordRes = await fetch('/api/underwriter/upload/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, conditionId, files: uploaded }),
      })
      if (!recordRes.ok) {
        const d = await recordRes.json().catch(() => ({}))
        setUploadError(d.error ?? 'Files uploaded but could not save records.')
      }
    }

    setUploadingSet(prev => { const next = new Set(prev); next.delete(conditionId); return next })
    router.refresh()
  }

  async function handleAddCondition() {
    if (!addTitle.trim()) { setAddError('Title is required'); return }
    setAddSaving(true); setAddError(null)
    const res = await fetch('/api/underwriter/conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify((() => {
        let resolvedRole: AssignedTo = addAssignedTo === 'other' ? 'borrower' : addAssignedTo
        let staffId: string | null = null
        if (addAssignedTo === 'other' && addAssignedToStaffId && staffDirectory) {
          if (staffDirectory.loan_officers.some(s => s.id === addAssignedToStaffId)) resolvedRole = 'loan_officer'
          else if (staffDirectory.loan_processors.some(s => s.id === addAssignedToStaffId)) resolvedRole = 'loan_processor'
          else if (staffDirectory.underwriters.some(s => s.id === addAssignedToStaffId)) resolvedRole = 'underwriter'
          staffId = addAssignedToStaffId
        }
        return { loanId, title: addTitle.trim(), description: addDescription.trim() || null, assignedTo: resolvedRole, assignedToStaffId: staffId, category: addCategory }
      })()),
    })
    const data = await res.json()
    if (data.success) {
      setAdding(false)
      setAddTitle('')
      setAddDescription('')
      setAddCategory('initial')
      setAddAssignedTo('borrower')
      setAddSaving(false)
      router.refresh()
    } else {
      setAddError(data.error ?? 'Failed to add condition')
      setAddSaving(false)
    }
  }

  const grouped = [...CONDITION_CATEGORIES, null].map(cat => {
    const catValue = cat ? cat.value : null
    const catLabel = cat ? cat.label : 'Uncategorized'
    const group = conditions.filter(c => (c.category ?? null) === catValue)
    return { catValue, catLabel, group }
  }).filter(g => g.group.length > 0)

  return (
    <div className="space-y-4">
      {uploadError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{uploadError}</p>}
      {updateError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{updateError}</p>}
      {deleteError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{deleteError}</p>}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Conditions</CardTitle>
          <div className="flex items-center gap-3">
            {/* Reminder — emails borrower or broker (broker wins)
                with the list of outstanding items. */}
            <ConditionReminderButton
              loanId={loanId}
              hasRecipient={!!hasReminderRecipient}
            />
            {!isImpersonating && (
              <>
                <button
                  onClick={() => { setBulkInitialDocs(undefined); setBulkModalOpen(true) }}
                  className="text-xs text-primary hover:opacity-80 font-medium"
                >
                  Bulk Upload
                </button>
                {!adding && (
                  <button onClick={() => setAdding(true)} className="text-xs text-primary hover:opacity-80 font-medium">
                    + Add Condition
                  </button>
                )}
              </>
            )}
          </div>
        </CardHeader>
        {adding && (
          <CardContent className="pt-0 space-y-3">
            <Input placeholder="Condition title *" value={addTitle} onChange={e => setAddTitle(e.target.value)} />
            <Input placeholder="Description (optional)" value={addDescription} onChange={e => setAddDescription(e.target.value)} />
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 font-medium">Category</p>
              <select value={addCategory} onChange={e => setAddCategory(e.target.value as ConditionCategory)}
                className="w-full text-sm px-3 py-2 rounded border border-gray-200 bg-white text-gray-700">
                {CONDITION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 font-medium">Assign to</p>
              <div className="flex gap-4 flex-wrap">
                {(['borrower', 'loan_officer', 'loan_processor', 'underwriter', 'other'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="uw-assign" value={opt} checked={addAssignedTo === opt}
                      onChange={() => { setAddAssignedTo(opt); setAddAssignedToStaffId('') }} className="accent-primary" />
                    {opt === 'borrower' ? 'Borrower' : opt === 'loan_officer' ? 'Loan Officer' : opt === 'loan_processor' ? 'Loan Processor' : opt === 'underwriter' ? 'Underwriter' : 'Other'}
                  </label>
                ))}
              </div>
            </div>
            {addAssignedTo === 'other' && staffDirectory && (
              <div className="space-y-1.5">
                <p className="text-xs text-gray-500 font-medium">Staff member</p>
                <select
                  value={addAssignedToStaffId}
                  onChange={e => setAddAssignedToStaffId(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded border border-gray-200 bg-white text-gray-700"
                >
                  <option value="">— Select a person —</option>
                  {staffDirectory.loan_officers.length > 0 && (
                    <optgroup label="Loan Officers">
                      {staffDirectory.loan_officers.map(p => (
                        <option key={p.id} value={p.id}>{p.full_name}</option>
                      ))}
                    </optgroup>
                  )}
                  {staffDirectory.loan_processors.length > 0 && (
                    <optgroup label="Loan Processors">
                      {staffDirectory.loan_processors.map(p => (
                        <option key={p.id} value={p.id}>{p.full_name}</option>
                      ))}
                    </optgroup>
                  )}
                  {staffDirectory.underwriters.length > 0 && (
                    <optgroup label="Underwriters">
                      {staffDirectory.underwriters.map(p => (
                        <option key={p.id} value={p.id}>{p.full_name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
            {addError && <p className="text-xs text-red-600">{addError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddCondition} disabled={addSaving}>{addSaving ? 'Adding...' : 'Add Condition'}</Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setAddTitle(''); setAddDescription(''); setAddCategory('initial'); setAddError(null) }}>Cancel</Button>
            </div>
          </CardContent>
        )}
      </Card>

      <UnmatchedDocumentsCard
        loanId={loanId}
        refreshKey={unmatchedRefreshKey}
        onMatchClick={(unmatchedDocs: UnmatchedDoc[]) => {
          const titles = conditions.map(c => ({ id: c.id, title: c.title }))
          setBulkInitialDocs(unmatchedDocs.map(u => {
            const suggested = suggestConditionId(u.file_name, titles)
            return {
              id: u.id,
              file_name: u.file_name,
              file_path: u.file_path,
              file_size: u.file_size,
              suggested_condition_id: suggested,
              staged_condition_id: suggested,
              confirmed: false,
            }
          }))
          setBulkModalOpen(true)
        }}
      />

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
                  <ConditionRow
                    key={condition.id}
                    condition={condition}
                    docs={getDocsForCondition(condition.id)}
                    signedUrlMap={signedUrlMap}
                    canUpload={canUpload}
                    uploading={uploadingSet.has(condition.id)}
                    selected={selectedConditions.has(condition.id)}
                    selectable={condition.status !== 'Satisfied' && condition.status !== 'Waived'}
                    loanStaff={loanStaff}
                    staffDirectory={staffDirectory}
                    notes={notesByCondition?.[condition.id]}
                    onToggleSelect={() => toggleConditionSelection(condition.id)}
                    onUpload={(files) => handleUpload(condition.id, files)}
                    fileRef={(el) => { fileInputRefs.current[condition.id] = el }}
                    onUpdateStatus={handleUpdateStatus}
                    onDeleteDoc={handleDeleteDoc}
                    onDeleteCondition={handleDeleteCondition}
                    onChangeCategory={handleChangeCategory}
                    onReassign={handleReassign}
                    onToggleUrgent={handleToggleUrgent}
                    isImpersonating={isImpersonating}
                    mentionableStaff={mentionableStaff}
                  />
                )
              })}
            </CardContent>
          </Card>
        )
      })}

      {conditions.length === 0 && !adding && (
        <Card><CardContent className="py-6">
          <p className="text-sm text-gray-500">No conditions have been added to this loan yet.</p>
        </CardContent></Card>
      )}

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
                        <TemplateAssigneePicker
                          value={templateAssigneeOverrides[template.id] ?? template.assigned_to ?? 'borrower'}
                          onChange={next => setTemplateAssigneeOverrides(prev => ({ ...prev, [template.id]: next }))}
                          disabled={isSaving || bulkSaving}
                        />
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

      {!isImpersonating && (
        <BulkActionBar
          count={selectedConditions.size}
          onClear={() => setSelectedConditions(new Set())}
          saving={bulkSaving}
          error={bulkError}
        >
          <BulkActionButton onClick={() => handleBulkStatus('Satisfied')} disabled={bulkSaving}>
            ✓ Satisfy
          </BulkActionButton>
          <BulkActionButton onClick={() => handleBulkStatus('Waived')} disabled={bulkSaving}>
            — Waive
          </BulkActionButton>
        </BulkActionBar>
      )}

      <BulkUploadModal
        loanId={loanId}
        conditions={conditions}
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        initialDocs={bulkInitialDocs}
        onSaved={() => { setUnmatchedRefreshKey(k => k + 1); router.refresh() }}
      />
    </div>
  )
}
