'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, FileText } from 'lucide-react'
import { type Condition, type Document, type ConditionStatus, CONDITION_CATEGORIES } from '@/lib/types'
import { DocumentPreviewLink } from '@/components/document-preview-link'

interface Props {
  loanId: string
  propertyAddress: string | null
  conditions: Condition[]
  documents: Document[]
  signedUrlMap?: Record<string, string>   // doc.id → signed download URL
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


export function ConditionsList({ loanId, propertyAddress, conditions, documents, signedUrlMap = {} }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [uploadingSet, setUploadingSet] = useState<Set<string>>(new Set())
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySaving, setReplySaving] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function openReply(conditionId: string, existing: string | null) {
    setReplyOpenId(conditionId)
    setReplyText(existing ?? '')
    setReplyError(null)
  }

  function cancelReply() {
    setReplyOpenId(null)
    setReplyText('')
    setReplyError(null)
  }

  async function handleSaveReply(conditionId: string) {
    if (!replyText.trim()) { setReplyError('Please enter a response'); return }
    setReplySaving(true)
    setReplyError(null)
    const res = await fetch('/api/loans/conditions/response', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionId, response: replyText.trim() }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      setReplyOpenId(null)
      setReplyText('')
      setReplySaving(false)
      router.refresh()
    } else {
      setReplyError(data.error ?? 'Could not save your response')
      setReplySaving(false)
    }
  }

  // Borrowers only see conditions assigned to them
  const borrowerConditions = conditions.filter(c => !c.assigned_to || c.assigned_to === 'borrower')

  function getDocsForCondition(conditionId: string): Document[] {
    return documents.filter(d => d.condition_id === conditionId)
  }

  async function uploadSingleFile(conditionId: string, file: File, conditionTitle: string): Promise<boolean> {
    const signRes = await fetch('/api/loans/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, conditionId, fileName: file.name, conditionTitle, propertyAddress }),
    })
    if (!signRes.ok) {
      const data = await signRes.json().catch(() => ({}))
      setUploadError(data.error ?? 'Could not start upload. Please try again.')
      return false
    }
    const { path, token } = await signRes.json()
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .uploadToSignedUrl(path, token, file, { contentType: file.type || 'application/octet-stream' })
    if (uploadErr) { setUploadError(`"${file.name}" upload failed: ` + uploadErr.message); return false }
    const recordRes = await fetch('/api/loans/upload/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loanId, conditionId, fileName: file.name, fileSize: file.size, path }),
    })
    if (!recordRes.ok) {
      const data = await recordRes.json().catch(() => ({}))
      setUploadError(data.error ?? 'File uploaded but could not save record. Please contact support.')
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

  if (borrowerConditions.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">No conditions have been added to this loan yet.</p>
        </CardContent>
      </Card>
    )
  }

  // Group by category
  const grouped = [...CONDITION_CATEGORIES, null].map(cat => {
    const catValue = cat ? cat.value : null
    const catLabel = cat ? cat.label : 'Conditions'
    const group = borrowerConditions.filter(c => (c.category ?? null) === catValue)
    return { catValue, catLabel, group }
  }).filter(g => g.group.length > 0)

  return (
    <div className="space-y-4">
      {uploadError && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{uploadError}</p>
      )}

      {grouped.map(({ catValue, catLabel, group }) => {
        const outstanding = group.filter(c => c.status === 'Outstanding' || c.status === 'Received').length
        const completed   = group.filter(c => c.status === 'Satisfied' || c.status === 'Waived').length
        return (
          <Card key={catValue ?? 'uncategorized'}>
            <CardHeader>
              <CardTitle className="text-base">
                {catLabel}
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {outstanding > 0
                    ? `${outstanding} remaining · ${completed} complete`
                    : 'all clear'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {group.map(condition => {
                const docs = getDocsForCondition(condition.id)
                const canUpload = condition.status === 'Outstanding' || condition.status === 'Received' || condition.status === 'Rejected'
                return (
                  <div
                    key={condition.id}
                    className={`border rounded-lg p-4 ${condition.status === 'Satisfied' || condition.status === 'Waived' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 text-sm">{condition.title}</p>
                        {condition.description && (
                          <p className="text-xs text-gray-500 mt-1">{condition.description}</p>
                        )}
                        {condition.status === 'Rejected' && condition.rejection_reason && (
                          <p className="text-xs text-red-600 mt-1 font-medium">
                            ⚠ Rejected: {condition.rejection_reason}
                          </p>
                        )}
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${statusColor(condition.status)}`}>
                        {condition.status}
                      </span>
                    </div>
                    {condition.response && replyOpenId !== condition.id && (
                      <div className="mt-3 bg-blue-50 border border-blue-100 rounded px-3 py-2">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-xs text-gray-500 font-medium">Your response</p>
                          {canUpload && (
                            <button
                              onClick={() => openReply(condition.id, condition.response)}
                              className="text-xs text-primary hover:opacity-80"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-gray-800 whitespace-pre-wrap">{condition.response}</p>
                      </div>
                    )}
                    {canUpload && (
                      <div className="mt-3">
                        <input
                          ref={(el) => { fileInputRefs.current[condition.id] = el }}
                          type="file" multiple className="hidden"
                          onChange={(e) => { if (e.target.files?.length) handleUpload(condition.id, e.target.files) }}
                        />
                        <div
                          onDragOver={(e) => { e.preventDefault(); setDragOverId(condition.id) }}
                          onDragLeave={() => setDragOverId(null)}
                          onDrop={(e) => {
                            e.preventDefault()
                            setDragOverId(null)
                            if (e.dataTransfer.files.length) handleUpload(condition.id, e.dataTransfer.files)
                          }}
                          onClick={() => {
                            if (uploadingSet.has(condition.id)) return
                            const el = fileInputRefs.current[condition.id]
                            if (el) { el.multiple = true; el.click() }
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              const el = fileInputRefs.current[condition.id]
                              if (el) { el.multiple = true; el.click() }
                            }
                          }}
                          className={`
                            rounded-lg border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-colors
                            ${dragOverId === condition.id
                              ? 'border-primary bg-primary/5'
                              : 'border-gray-300 hover:border-primary/50 hover:bg-gray-50'}
                            ${uploadingSet.has(condition.id) ? 'opacity-60 cursor-wait' : ''}
                          `}
                        >
                          <Upload className="w-5 h-5 text-gray-400 mx-auto mb-1.5" />
                          <p className="text-sm text-gray-700 font-medium">
                            {uploadingSet.has(condition.id) ? 'Uploading…' : 'Drop files here or click to upload'}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">PDF, JPG, PNG, DOCX</p>
                        </div>

                        {replyOpenId === condition.id ? (
                          <div className="mt-3 space-y-2">
                            <textarea
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              placeholder="e.g. No mortgage on the property — owned free and clear."
                              className="w-full text-sm px-3 py-2 rounded-md border border-gray-300 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[80px]"
                              autoFocus
                            />
                            {replyError && <p className="text-xs text-red-600">{replyError}</p>}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSaveReply(condition.id)}
                                disabled={replySaving}
                                className="text-sm px-3 py-1.5 rounded-md bg-primary text-white font-medium hover:opacity-90 disabled:opacity-50"
                              >
                                {replySaving ? 'Saving…' : 'Save response'}
                              </button>
                              <button
                                onClick={cancelReply}
                                disabled={replySaving}
                                className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          !condition.response && (
                            <button
                              onClick={() => openReply(condition.id, null)}
                              className="mt-2 text-xs text-primary hover:opacity-80"
                            >
                              Or write a response instead →
                            </button>
                          )
                        )}
                      </div>
                    )}
                    {docs.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {docs.map(doc => {
                          const url = signedUrlMap[doc.id]
                          return (
                            <div key={doc.id} className="flex items-center gap-2 text-xs">
                              <FileText className="w-3.5 h-3.5 text-gray-400" />
                              {url ? (
                                <DocumentPreviewLink
                                  url={url}
                                  fileName={doc.file_name}
                                  className="text-primary hover:opacity-80 truncate underline underline-offset-2 text-left"
                                />
                              ) : (
                                <span className="text-gray-600 truncate">{doc.file_name}</span>
                              )}
                              <span className="text-gray-400 whitespace-nowrap">·</span>
                              <span className="text-gray-400 whitespace-nowrap">
                                {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
