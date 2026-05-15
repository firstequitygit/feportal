'use client'

import { Download } from 'lucide-react'

interface Props {
  /** Filename shown in the browser's save dialog (without .csv). */
  fileName: string
  /** Column headers. Order is preserved. */
  headers: string[]
  /** Rows aligned to headers. Each cell can be string | number | null. */
  rows: Array<Array<string | number | null | undefined>>
}

/**
 * One-click CSV export button. No server roundtrip — builds the file in-browser
 * from data the parent already has on hand.
 */
export function CsvDownloadButton({ fileName, headers, rows }: Props) {
  function escape(cell: string | number | null | undefined): string {
    if (cell === null || cell === undefined) return ''
    const s = String(cell)
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  function handleDownload() {
    const csv = [
      headers.map(escape).join(','),
      ...rows.map(r => r.map(escape).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleDownload}
      className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-md"
      disabled={rows.length === 0}
    >
      <Download className="w-3.5 h-3.5" />
      Download CSV
    </button>
  )
}
