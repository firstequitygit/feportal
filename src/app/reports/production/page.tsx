import Link from 'next/link'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/lib/supabase/admin'
import { getReportContext, roleLabel } from '@/lib/reports/auth'
import { CsvDownloadButton } from '@/components/reports/csv-download-button'
import { DateRangeFilter } from '@/components/reports/date-range-filter'
import { ArrowLeft } from 'lucide-react'

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function startOfYearIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-01-01`
}

function lastNDaysIso(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

interface CloseEvent {
  loan_id: string
  entered_at: string
}

export default async function ProductionReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const ctx = await getReportContext()
  const { from: fromParam, to: toParam } = await searchParams
  const from = fromParam || startOfYearIso()
  const to = toParam || todayIso()

  const adminClient = createAdminClient()

  // 1. Find all 'Closed' stage entries in the date range from loan_stage_history.
  //    Fall back to origination_date if loan_stage_history has no row for that loan.
  const { data: closedEvents } = await adminClient
    .from('loan_stage_history')
    .select('loan_id, entered_at')
    .eq('stage', 'Closed')
    .gte('entered_at', `${from}T00:00:00Z`)
    .lte('entered_at', `${to}T23:59:59Z`)

  const closedLoanIdsFromHistory = new Set(
    ((closedEvents ?? []) as CloseEvent[]).map(e => e.loan_id),
  )

  // 2. Also pull loans whose origination_date falls in range as a fallback for loans
  //    that closed before we started tracking stage history.
  const { data: originatedLoans } = await adminClient
    .from('loans')
    .select('id')
    .gte('origination_date', from)
    .lte('origination_date', to)
    .eq('pipeline_stage', 'Closed')

  const closedLoanIds = new Set<string>([
    ...closedLoanIdsFromHistory,
    ...((originatedLoans ?? []) as { id: string }[]).map(l => l.id),
  ])

  // 3. Pull full loan records for those IDs (scoped to current user's role)
  type LoanRow = {
    id: string
    loan_amount: number | null
    loan_officer_id: string | null
    loan_officers: { full_name: string } | null
    pipeline_stage: string | null
  }

  let detail: LoanRow[] = []
  if (closedLoanIds.size > 0) {
    let q = adminClient
      .from('loans')
      .select('id, loan_amount, loan_officer_id, pipeline_stage, loan_officers(full_name)')
      .in('id', Array.from(closedLoanIds))
    if (ctx.loanScopeColumn && ctx.loanScopeId) {
      q = q.eq(ctx.loanScopeColumn, ctx.loanScopeId)
    }
    const { data } = await q
    detail = (data ?? []) as unknown as LoanRow[]
  }

  // Aggregate by loan officer
  const byLo = new Map<string, { loId: string | null; name: string; count: number; volume: number }>()
  for (const l of detail) {
    const key = l.loan_officer_id ?? '__unassigned__'
    const name = l.loan_officers?.full_name ?? '(Unassigned)'
    const cur = byLo.get(key) ?? { loId: l.loan_officer_id, name, count: 0, volume: 0 }
    cur.count += 1
    cur.volume += l.loan_amount ?? 0
    byLo.set(key, cur)
  }
  const rows = Array.from(byLo.values()).sort((a, b) => b.volume - a.volume)
  const totalCount = rows.reduce((s, r) => s + r.count, 0)
  const totalVolume = rows.reduce((s, r) => s + r.volume, 0)
  const maxVolume = Math.max(1, ...rows.map(r => r.volume))

  const csvHeaders = ['Loan Officer', 'Closed Loans', 'Total Volume', 'Avg Loan Size']
  const csvRows = rows.map(r => [
    r.name,
    r.count,
    Math.round(r.volume),
    r.count > 0 ? Math.round(r.volume / r.count) : 0,
  ])
  csvRows.push(['Total', totalCount, Math.round(totalVolume), totalCount > 0 ? Math.round(totalVolume / totalCount) : 0])

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
          <h2 className="text-2xl font-bold text-gray-900">Production by Loan Officer</h2>
          <p className="text-sm text-gray-500 mt-1">
            Closed loans from {from} to {to}
            {ctx.role !== 'admin' && ' · scoped to your loans'}
          </p>
        </div>
        <CsvDownloadButton fileName={`production-${from}-to-${to}`} headers={csvHeaders} rows={csvRows} />
      </div>

      <DateRangeFilter
        from={from}
        to={to}
        presets={[
          { label: 'YTD', from: startOfYearIso(), to: todayIso() },
          { label: 'Last 30 days', from: lastNDaysIso(30), to: todayIso() },
          { label: 'Last 90 days', from: lastNDaysIso(90), to: todayIso() },
          { label: 'Last 12 months', from: lastNDaysIso(365), to: todayIso() },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Production
            <span className="ml-2 text-sm font-normal text-gray-500">
              {totalCount} loan{totalCount === 1 ? '' : 's'} · {formatCurrency(totalVolume)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500 italic py-6 text-center">
              No closed loans in this date range.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                  <th className="pb-2 font-medium">Loan Officer</th>
                  <th className="pb-2 font-medium text-right">Closed</th>
                  <th className="pb-2 font-medium text-right">Volume</th>
                  <th className="pb-2 font-medium text-right">Avg Size</th>
                  <th className="pb-2 font-medium pl-6 w-1/3">Volume share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.loId ?? '__unassigned__'} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2.5 font-medium text-gray-900">{r.name}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.count}</td>
                    <td className="py-2.5 text-right tabular-nums text-gray-700">{formatCurrency(r.volume)}</td>
                    <td className="py-2.5 text-right tabular-nums text-gray-700">
                      {r.count > 0 ? formatCurrency(r.volume / r.count) : '—'}
                    </td>
                    <td className="py-2.5 pl-6">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${(r.volume / maxVolume) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="pt-3">Total</td>
                  <td className="pt-3 text-right tabular-nums">{totalCount}</td>
                  <td className="pt-3 text-right tabular-nums">{formatCurrency(totalVolume)}</td>
                  <td className="pt-3 text-right tabular-nums">
                    {totalCount > 0 ? formatCurrency(totalVolume / totalCount) : '—'}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
