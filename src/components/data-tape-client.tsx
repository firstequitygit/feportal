'use client'

// Client-side wrapper that polls /api/data-tape after mount and
// hands the result to the DataTape component. Lifts the heavy
// fetch out of the page's server component so SSR stays tiny and
// the page shell can render even if the data fetch ultimately
// fails — error gets shown as a banner above the table instead
// of as a Next.js 500.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { DataTape } from './data-tape'
import type { DataTapeRow } from '@/lib/fetch-data-tape'

interface ApiResult {
  rows?: DataTapeRow[]
  totalMatching?: number
  capped?: boolean
  errorMessage?: string | null
  error?: string
}

interface Props {
  /** Server pages pass a STRING (not a function) — functions aren't
   *  serializable across the Server-Component → Client-Component
   *  boundary and Next.js will 500 the route if you try. The href
   *  builder lives inside this client component instead. */
  loanDetailHrefPrefix: string
  /** Cap from the server — surfaced in the banner so the user knows
   *  when results were clipped. */
  maxRows: number
}

export function DataTapeClient({ loanDetailHrefPrefix, maxRows }: Props) {
  const loanDetailHref = (loanId: string) => `${loanDetailHrefPrefix}/${loanId}`
  const [data, setData] = useState<ApiResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFetchError(null)
    fetch('/api/data-tape', { credentials: 'include' })
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok) {
          setFetchError(
            (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
              ? json.error
              : `Failed to load (HTTP ${res.status})`),
          )
          setData(null)
        } else {
          setData(json as ApiResult)
        }
      })
      .catch(err => {
        if (cancelled) return
        setFetchError(err instanceof Error ? err.message : 'Network error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="rounded-md border border-gray-200 bg-white px-4 py-12 flex items-center justify-center gap-2 text-sm text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading data tape…
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
        Could not load loans: {fetchError}
      </div>
    )
  }

  const rows = data?.rows ?? []
  const errorMessage = data?.errorMessage ?? null
  const capped = data?.capped ?? false
  const totalMatching = data?.totalMatching ?? 0

  return (
    <div className="space-y-3">
      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          Could not load loans: {errorMessage}
        </div>
      )}
      {capped && !errorMessage && (
        <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-sm">
          Showing the {maxRows} most recently created loans of{' '}
          <strong>{totalMatching}</strong> matching loans. Use the search and
          filters below to narrow further; the CSV export covers everything
          currently visible.
        </div>
      )}
      <DataTape rows={rows} loanDetailHref={loanDetailHref} />
    </div>
  )
}
