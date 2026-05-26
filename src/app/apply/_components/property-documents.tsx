'use client'
import { useRef, useState, useCallback, DragEvent } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { ApplicationData } from '@/lib/application-fields'

export type PropertyDoc = {
  path: string
  filename: string
  size: number
  uploadedAt: number
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const ACCEPTED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.xlsx', '.xls', '.csv', '.doc', '.docx']
const MAX_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_TYPES.includes(file.type)) return true
  const lower = file.name.toLowerCase()
  return ACCEPTED_EXTS.some(ext => lower.endsWith(ext))
}

interface Props {
  token: string | null
  documents: PropertyDoc[]
  set: (patchOrFn: Record<string, unknown> | ((d: ApplicationData) => Record<string, unknown>)) => void
}

export function PropertyDocuments({ token, documents, set }: Props) {
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const browserClient = createClient()

  const uploadFile = useCallback(async (file: File) => {
    if (!token) return

    if (!isAcceptedFile(file)) {
      toast.error(`"${file.name}" is not an accepted file type. Use PDF, images, spreadsheets, or Word docs.`)
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast.error(`"${file.name}" is too large (max 25 MB).`)
      return
    }

    const key = `${file.name}-${Date.now()}`
    setUploading(prev => ({ ...prev, [key]: true }))

    try {
      // 1. Mint a signed upload URL from the server
      const res = await fetch('/api/apply/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeToken: token, filename: file.name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Server error ${res.status}`)
      }
      const { path, token: uploadToken } = await res.json() as { path: string; token: string }

      // 2. Upload the bytes directly from the browser via signed URL
      const { error } = await browserClient.storage
        .from('documents')
        .uploadToSignedUrl(path, uploadToken, file)
      if (error) throw new Error(error.message)

      // 3. Append to data.property_documents via wizard's set
      const doc: PropertyDoc = {
        path,
        filename: file.name,
        size: file.size,
        uploadedAt: Date.now(),
      }
      set({ property_documents: [...documents, doc] })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Upload failed for "${file.name}": ${msg}`)
    } finally {
      setUploading(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }, [token, documents, set, browserClient])

  const handleFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      uploadFile(file)
    }
  }, [uploadFile])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
  }, [])

  const removeDoc = (idx: number) => {
    const next = documents.filter((_, i) => i !== idx)
    set({ property_documents: next })
  }

  const isUploadingAny = Object.keys(uploading).length > 0
  const disabled = !token

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Property Documents</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Optional. Upload anything that helps us evaluate your deal faster - for example a rent roll,
          income statements, building plans, construction budget, or purchase contract.
        </p>
      </div>

      {disabled ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center">
          <p className="text-sm text-gray-400">
            Enter your email on Step 1 to enable document uploads.
          </p>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label="Document upload area - drag files here or press Enter to choose files"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={[
            'cursor-pointer rounded-lg border border-dashed px-4 py-6 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-[#1F5D8F] focus:ring-offset-1',
            dragActive
              ? 'border-[#1F5D8F] bg-[#1F5D8F]/5'
              : 'border-gray-300 bg-gray-50 hover:border-[#1F5D8F] hover:bg-[#1F5D8F]/5',
          ].join(' ')}
        >
          <svg
            className="mx-auto mb-2 h-8 w-8 text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-sm font-medium text-gray-700">
            {dragActive ? 'Drop files here' : 'Drag files here or click to choose'}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            PDF, images, spreadsheets, Word docs - up to 25 MB each
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTS.join(',')}
            className="sr-only"
            onChange={(e) => { if (e.target.files) { handleFiles(e.target.files); e.target.value = '' } }}
          />
        </div>
      )}

      {/* Uploading indicators */}
      {isUploadingAny && (
        <ul className="space-y-1.5">
          {Object.keys(uploading).map((key) => {
            const filename = key.replace(/-\d+$/, '')
            return (
              <li key={key} className="flex items-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                <svg className="h-4 w-4 shrink-0 animate-spin text-[#1F5D8F]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="truncate">Uploading {filename}...</span>
              </li>
            )
          })}
        </ul>
      )}

      {/* Uploaded files list */}
      {documents.length > 0 && (
        <ul className="space-y-1.5">
          {documents.map((doc, idx) => (
            <li key={doc.path} className="flex items-center justify-between gap-3 rounded-md border border-gray-100 bg-white px-3 py-2 text-sm shadow-sm">
              <div className="flex min-w-0 items-center gap-2">
                <svg className="h-4 w-4 shrink-0 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <span className="truncate font-medium text-gray-800">{doc.filename}</span>
                <span className="shrink-0 text-xs text-gray-400">{humanSize(doc.size)}</span>
              </div>
              <button
                type="button"
                onClick={() => removeDoc(idx)}
                aria-label={`Remove ${doc.filename}`}
                className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
