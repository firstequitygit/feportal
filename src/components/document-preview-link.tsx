'use client'

import { useEffect, useState } from 'react'
import { X, Download, ExternalLink } from 'lucide-react'

interface Props {
  url: string
  fileName: string
  className?: string
}

type RendererKind = 'pdf' | 'image' | 'office' | 'text' | 'unsupported'

function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

function rendererFor(fileName: string): RendererKind {
  const ext = extOf(fileName)
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
  if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext)) return 'office'
  if (['txt', 'csv', 'json', 'md', 'html', 'xml', 'log'].includes(ext)) return 'text'
  return 'unsupported'
}

export function DocumentPreviewLink({ url, fileName, className }: Props) {
  const [open, setOpen] = useState(false)

  // Lock body scroll while modal is open + close on Esc
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const kind = rendererFor(fileName)
  const officeViewerUrl =
    kind === 'office'
      ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
      : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'text-primary hover:opacity-80 font-medium underline underline-offset-2 text-left'
        }
      >
        {fileName}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl flex flex-col w-full h-full max-w-[98vw] max-h-[98vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-200 flex-shrink-0">
              <p className="text-sm font-medium text-gray-900 truncate flex-1" title={fileName}>
                {fileName}
              </p>
              <div className="flex items-center gap-1 flex-shrink-0">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-gray-100"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </a>
                <a
                  href={url}
                  download={fileName}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-gray-100"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 bg-gray-50">
              {kind === 'pdf' && (
                <iframe src={url} className="w-full h-full" title={fileName} />
              )}
              {kind === 'image' && (
                <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
                  <img
                    src={url}
                    alt={fileName}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              )}
              {kind === 'office' && officeViewerUrl && (
                <iframe src={officeViewerUrl} className="w-full h-full" title={fileName} />
              )}
              {kind === 'text' && (
                <iframe src={url} className="w-full h-full bg-white" title={fileName} />
              )}
              {kind === 'unsupported' && (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-center p-8">
                  <p className="text-sm text-gray-600">
                    No inline preview available for this file type.
                  </p>
                  <div className="flex items-center gap-2">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm bg-primary text-white px-4 py-2 rounded-md hover:opacity-90"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open in new tab
                    </a>
                    <a
                      href={url}
                      download={fileName}
                      className="flex items-center gap-1.5 text-sm border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
