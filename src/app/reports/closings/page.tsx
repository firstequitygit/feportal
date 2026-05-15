import Link from 'next/link'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/lib/supabase/admin'
import { getReportContext, roleLabel } from '@/lib/reports/auth'
import { CsvDownloadButton } from '@/components/reports/csv-download-button'
import { ArrowLeft } from 'lucide-react'

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function monthLabel(year: number, monthIdx: number): string {
  return new Date(year, monthIdx, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

interface LoanRow {
  id: string
  loan_amount: number | null
  origination_date: string | null
  pipeline_stage: string | null
  loan_officer_id: string | null
}

export default async function ClosingsByMonthPage() {
  const ctx = await getReportContext()
  const adminClient = createAdminClient()

  // Trailing 12 months window — first of the month 11 months ago through today
  const now = new Date()
  const startYear = now.getFullYear()
  const startMonth = now.getMonth() - 11
  const windowStart = new Date(startYear, startMonth, 1)
  const windowStartIso = windowStart.toISOString().slice(0, 10)
  const todayIso = now.toISOString().slice(0, 10)

  // Closed loans = pipeline_stage 'Closed' with origination_date inside the window.
  let q = adminClient
    .from('loans')
    .select('id, loan_amount, origination_date, pipeline_stage, loan_officer_id')
    .eq('pipeline_stage', 'Closed')
    .gte('origination_date', windowStartIso)
    .lte('origination_date', todayIso)
  if (ctx.loanScopeColumn && ctx.loanScopeId) {
    q = q.eq(ctx.loanScopeColumn, ctx.loanScopeId)
  }
  const { data: loanData } = await q
  const loanRows: LoanRow[] = (loanData ?? []) as LoanRow[]

  // Bucket by month using origination_date
  type Bucket = { year: number; monthIdx: number; label: string; count: number; volume: number }
  const buckets: Bucket[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYear, startMonth + i, 1)
    buckets.push({
      year: d.getFullYear(),
      monthIdx: d.getMonth(),
      label: monthLabel(d.getFullYear(), d.getMonth()),
      count: 0,
      volume: 0,
    })
  }
  for (const l of loanRows) {
    if (!l.origination_date) continue
    // Parse YYYY-MM-DD as local date to avoid UTC drift on dates near midnight
    const [y, m] = l.origination_date.split('-').map(Number)
    const b = buckets.find(b => b.year === y && b.monthIdx === m - 1)
    if (!b) continue
    b.count += 1
    b.volume += l.loan_amount ?? 0
  }

  const totalCount = buckets.reduce((s, b) => s + b.count, 0)
  const totalVolume = buckets.reduce((s, b) => s + b.volume, 0)
  const maxVolume = Math.max(1, ...buckets.map(b => b.volume))

  const csvHeaders = ['Month', 'Closed Loans', 'Total Volume']
  const csvRows = buckets.map(b => [b.label, b.count, Math.round(b.volume)])
  csvRows.push(['Total', totalCount, Math.round(totalVolume)])

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
            Trailing 12 months · {totalCount} closed loan{totalCount === 1 ? '' : 's'} · {formatCurrency(totalVolume)} total volume
            {ctx.role !== 'admin' && ' · scoped to your loans'}
          </p>
        </div>
        <CsvDownloadButton fileName="closings-by-month" headers={csvHeaders} rows={csvRows} />
      </div>

      <Card>
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
              {buckets.map(b => (
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
    </PortalShell>
  )
}
