'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

interface TestResult {
  scenario: string | null
  recipients: { borrower: string | null; internal: string[] }
  pdfBytes: number
  data: unknown
}

export default function TestSubmittedPage() {
  const [result, setResult] = useState<TestResult | null>(null)
  const [redownloading, setRedownloading] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('fe-apply-test-result')
      if (raw) setResult(JSON.parse(raw) as TestResult)
    } catch { /* ignore */ }
  }, [])

  async function redownloadPdf() {
    if (!result) return
    setRedownloading(true)
    try {
      const res = await fetch('/api/apply/test-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.data }),
      })
      if (!res.ok) { toast.error('Could not re-render the PDF'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'test-application.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setRedownloading(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Test mode submission</strong> - nothing was written to live loans, borrowers, or storage.
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-[#1F5D8F]">Test application processed</h1>

        {!result ? (
          <p className="text-slate-600">No test result found in this session. Start a new test from <Link href="/apply" className="font-medium text-[#1F5D8F] underline">/apply</Link>.</p>
        ) : (
          <>
            <dl className="my-6 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Scenario</dt>
                <dd className="font-medium text-slate-900">{result.scenario ?? '-'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Borrower email</dt>
                <dd className="font-medium text-slate-900">{result.recipients.borrower ?? 'not sent'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Internal email recipients</dt>
                <dd className="font-medium text-slate-900 text-right">
                  {result.recipients.internal.length > 0
                    ? result.recipients.internal.join(', ')
                    : 'not sent'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">PDF size</dt>
                <dd className="font-medium text-slate-900">{result.pdfBytes.toLocaleString()} bytes</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={redownloadPdf}
                disabled={redownloading}
                className="inline-flex h-10 items-center rounded-md border border-[#1F5D8F] px-4 text-sm font-semibold text-[#1F5D8F] hover:bg-[#1F5D8F]/5 disabled:opacity-60"
              >
                {redownloading ? 'Re-rendering…' : 'Re-download PDF'}
              </button>
              <Link
                href="/apply"
                className="inline-flex h-10 items-center rounded-md bg-[#1F5D8F] px-4 text-sm font-semibold text-white hover:bg-[#0F3A5E]"
              >
                Run another test
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
