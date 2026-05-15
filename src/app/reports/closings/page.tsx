import Link from 'next/link'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/lib/supabase/admin'
import { getReportContext, roleLabel, loanDetailHref } from '@/lib/reports/auth'
import { CsvDownloadButton } from '@/components/reports/csv-download-button'
import { ClosingsWindowFilter } from '@/components/reports/closings-window-filter'
import { ArrowLeft } from 'lucide-react'

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function monthLabel(year: number, monthIdx: number): string {
  return new Date(year, monthIdx, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface LoanRow {
  id: string
  property_address: string | null
  loan_amount: number | null
  closed_at: string | null
  estimated_closing_date: string | null
  pipeline_stage: string | null
  loan_officer_id: string | null
  archived: boolean | null
  borrowers: { full_name: string | null } | null
  loan_officers: { full_name: string | null } | null
}

// Bucket date: prefer the scheduled "Closing Date" from Pipedrive, fall back
// to actual won_time. This matches the loan-officer's "closings by month"
// view in Pipedrive, which uses Closing Date — a loan funded May 1 but
// scheduled to close April 30 counts as April.
function bucketIso(l: LoanRow): string | null {
  return l.estimated_closing_date ?? l.closed_at
}

const WINDOW_OPTIONS = new Set(['12', '24', '36', 'all'])

export default async function ClosingsByMonthPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>
}) {
  const ctx = await getReportContext()
  const adminClient = createAdminClient()

  // Window: 'all' or trailing N months. Default 24.
  const { months: monthsParam } = await searchParams
  const monthsKey = WINDOW_OPTIONS.has(monthsParam ?? '') ? (monthsParam as string) : '24'
  const now = new Date()
  const nowMonthFirst = new Date(now.getFullYear(), now.getMonth(), 1)

  let windowStartIso: string | null = null
  let windowLabel = 'All time'
  if (monthsKey !== 'all') {
    const months = parseInt(monthsKey, 10)
    const windowStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
    windowStartIso = windowStart.toISOString()
    windowLabel = `Last ${months} months`
  }

  // All loans that reached the Closed stage AND were won. The pipeline_stage
  // filter excludes Pipedrive Lost deals (they don't advance to Closed). We
  // still require closed_at IS NOT NULL as the "the deal actually funded"
  // guarantee — but bucketing happens by estimated_closing_date (the Pipedrive
  // "Closing Date" custom field, i.e. the scheduled/expected close) so a loan
  // scheduled to close April 30 but funded May 1 counts as April. Archived
  // loans are still included (auto-archived 30d after close = real history).
  // Window filter applies to whichever date drives the bucket (max of the two).
  let q = adminClient
    .from('loans')
    .select('id, property_address, loan_amount, closed_at, estimated_closing_date, pipeline_stage, loan_officer_id, archived, borrowers(full_name), loan_officers(full_name)')
    .eq('pipeline_stage', 'Closed')
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
  // Window filter: keep rows whose estimated_closing_date OR closed_at is in window
  if (windowStartIso) {
    q = q.or(`estimated_closing_date.gte.${windowStartIso.slice(0,10)},closed_at.gte.${windowStartIso}`)
  }
  if (ctx.loanScopeColumn && ctx.loanScopeId) {
    q = q.eq(ctx.loanScopeColumn, ctx.loanScopeId)
  }

  // Paginate to avoid PostgREST's 1000-row cap. Closings span 2017+ in FE.
  const loanRows: LoanRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await q.range(from, from + 999)
    if (error || !data) break
    loanRows.push(...(data as unknown as LoanRow[]))
    if (data.length < 1000) break
    from += 1000
  }

  // Bucket by month using closed_at. Months are derived from data when 'all',
  // otherwise we generate the full trailing-N-months range so zero months show.
  type Bucket = { year: number; monthIdx: number; label: string; count: number; volume: number; loans: LoanRow[] }
  const bucketMap = new Map<string, Bucket>()
  function bucketKey(y: number, m: number) { return `${y}-${m}` }
  function ensureBucket(y: number, m: number): Bucket {
    const k = bucketKey(y, m)
    let b = bucketMap.get(k)
    if (!b) {
      b = { year: y, monthIdx: m, label: monthLabel(y, m), count: 0, volume: 0, loans: [] }
      bucketMap.set(k, b)
    }
    return b
  }

  if (monthsKey !== 'all') {
    const months = parseInt(monthsKey, 10)
    for (let i = 0; i < months; i++) {
      const d = new Date(nowMonthFirst.getFullYear(), nowMonthFirst.getMonth() - (months - 1) + i, 1)
      ensureBucket(d.getFullYear(), d.getMonth())
    }
  }

  // Filter to loans that have a bucket date AND fall in the window
  // (after the scheduled-date switch, a Pipedrive-Lost-time row could slip in
  // via the OR filter above with only closed_at in range — drop those that
  // don't actually bucket into the visible window).
  const windowStartMs = windowStartIso ? new Date(windowStartIso).getTime() : -Infinity
  for (const l of loanRows) {
    const iso = bucketIso(l)
    if (!iso) continue
    if (new Date(iso).getTime() < windowStartMs) continue
    const d = new Date(iso)
    const b = ensureBucket(d.getFullYear(), d.getMonth())
    b.count += 1
    b.volume += l.loan_amount ?? 0
    b.loans.push(l)
  }

  // Sort: oldest-first for the summary table (chronological volume trend),
  // newest-first for the per-month detail (most relevant first).
  const bucketsAsc = [...bucketMap.values()].sort((a, b) =>
    a.year === b.year ? a.monthIdx - b.monthIdx : a.year - b.year
  )
  const bucketsDesc = [...bucketsAsc].reverse()
  for (const b of bucketsAsc) {
    b.loans.sort((a, b) => (bucketIso(b) ?? '').localeCompare(bucketIso(a) ?? ''))
  }

  const totalCount = bucketsAsc.reduce((s, b) => s + b.count, 0)
  const totalVolume = bucketsAsc.reduce((s, b) => s + b.volume, 0)
  const maxVolume = Math.max(1, ...bucketsAsc.map(b => b.volume))

  // CSV: one row per loan, plus a totals row at the end. Close Date is the
  // scheduled "Closing Date" from Pipedrive (the same date the report buckets
  // by); Funded On is the actual won_time so it's still visible.
  const csvHeaders = ['Month', 'Close Date', 'Funded On', 'Property', 'Borrower', 'Loan Officer', 'Loan Amount', 'Archived']
  const csvRows: (string | number)[][] = []
  for (const b of bucketsDesc) {
    for (const l of b.loans) {
      csvRows.push([
        b.label,
        bucketIso(l)?.slice(0, 10) ?? '',
        l.closed_at?.slice(0, 10) ?? '',
        l.property_address ?? '',
        l.borrowers?.full_name ?? '',
        l.loan_officers?.full_name ?? '',
        l.loan_amount ?? 0,
        l.archived ? 'yes' : 'no',
      ])
    }
  }
  csvRows.push(['Total', '', '', '', '', '', `${totalCount} loans`, Math.round(totalVolume)])

  return (
    <PortalShell
      userName={ctx.userName}
      userRole={roleLabel(ctx.role)}
      dashboardHref={ctx.dashboardHref}
      variant={ctx.shellVariant}
    >
      <Link href="/reports" className="flex items-center gap-1.5 text-sm text-primary hover:opacity-80 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Reports
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Closings by Month</h2>
          <p className="text-sm text-gray-500 mt-1">
            {windowLabel} · {totalCount} closed loan{totalCount === 1 ? '' : 's'} · {formatCurrency(totalVolume)} total volume
            {ctx.role !== 'admin' && ' · scoped to your loans'}
          </p>
        </div>
        <CsvDownloadButton fileName="closings-by-month" headers={csvHeaders} rows={csvRows} />
      </div>

      <ClosingsWindowFilter current={monthsKey} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Monthly Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                <th className="pb-2 font-medium">Month</th>
                <th className="pb-2 font-medium text-right">Closed</th>
                <th className="pb-2 font-medium text-right">Volume</th>
                <th className="pb-2 font-medium pl-6 w-1/2">Volume trend</th>
              </tr>
            </thead>
            <tbody>
              {bucketsAsc.map(b => (
                <tr key={b.label} className="border-b border-gray-100 last:border-b-0">
                  <td className="py-2.5 font-medium text-gray-900">{b.label}</td>
                  <td className="py-2.5 text-right tabular-nums">{b.count}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-700">{formatCurrency(b.volume)}</td>
                  <td className="py-2.5 pl-6">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(b.volume / maxVolume) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="pt-3">Total</td>
                <td className="pt-3 text-right tabular-nums">{totalCount}</td>
                <td className="pt-3 text-right tabular-nums">{formatCurrency(totalVolume)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Loans by Month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {bucketsDesc.filter(b => b.count > 0).length === 0 ? (
            <p className="text-sm text-gray-500 italic py-4 text-center">No closed loans in this window.</p>
          ) : (
            // Most recent month first. Default-open the first 6 months;
            // older months are collapsed by default so the page isn't a wall.
            bucketsDesc.filter(b => b.count > 0).map((b, idx) => (
              <details
                key={b.label}
                {...(idx < 6 ? { open: true } : {})}
                className="border border-gray-200 rounded-lg overflow-hidden group"
              >
                <summary className="cursor-pointer list-none px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between gap-4">
                  <div className="flex items-baseline gap-3">
                    <span className="font-semibold text-gray-900">{b.label}</span>
                    <span className="text-xs text-gray-500">
                      {b.count} loan{b.count === 1 ? '' : 's'} · {formatCurrency(b.volume)}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase bg-white">
                      <th className="px-4 py-2 font-medium">Close Date</th>
                      <th className="px-4 py-2 font-medium">Property</th>
                      <th className="px-4 py-2 font-medium">Borrower</th>
                      <th className="px-4 py-2 font-medium">Loan Officer</th>
                      <th className="px-4 py-2 font-medium text-right">Loan Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.loans.map(l => (
                      <tr key={l.id} className="border-b border-gray-100 last:border-b-0">
                        <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{formatDate(bucketIso(l))}</td>
                        <td className="px-4 py-2 font-medium text-gray-900">
                          <Link href={loanDetailHref(ctx.role, l.id)} className="hover:text-primary">
                            {l.property_address ?? '—'}
                          </Link>
                          {l.archived && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Archived</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-700">{l.borrowers?.full_name ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-700">{l.loan_officers?.full_name ?? '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                          {l.loan_amount === null ? '—' : formatCurrency(l.loan_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
