import Link from 'next/link'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/lib/supabase/admin'
import { getReportContext, roleLabel } from '@/lib/reports/auth'
import { PIPELINE_STAGES, type PipelineStage, type Loan } from '@/lib/types'
import { CsvDownloadButton } from '@/components/reports/csv-download-button'
import { ArrowLeft } from 'lucide-react'

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

export default async function PipelineReportPage() {
  const ctx = await getReportContext()
  const adminClient = createAdminClient()

  // Pull active (non-archived) loans, scoped to this user's role
  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set((archivedIds ?? []).map((r: { loan_id: string }) => r.loan_id))

  let query = adminClient.from('loans').select('*').eq('archived', false)
  if (ctx.loanScopeColumn && ctx.loanScopeId) {
    query = query.eq(ctx.loanScopeColumn, ctx.loanScopeId)
  }
  const { data: loans } = await query

  const active = (loans ?? []).filter((l: Loan) => !archivedSet.has(l.id))

  // Aggregate by stage
  const stageRows = PIPELINE_STAGES.map((stage: PipelineStage) => {
    const inStage = active.filter((l: Loan) => l.pipeline_stage === stage)
    const totalVolume = inStage.reduce((sum: number, l: Loan) => sum + (l.loan_amount ?? 0), 0)
    return {
      stage,
      count: inStage.length,
      totalVolume,
    }
  })

  const grandCount = stageRows.reduce((s, r) => s + r.count, 0)
  const grandVolume = stageRows.reduce((s, r) => s + r.totalVolume, 0)
  const maxCount = Math.max(1, ...stageRows.map(r => r.count))

  const csvHeaders = ['Stage', 'Loan Count', 'Total Volume']
  const csvRows = stageRows.map(r => [r.stage, r.count, r.totalVolume])
  csvRows.push(['Total', grandCount, grandVolume])

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
          <h2 className="text-2xl font-bold text-gray-900">Pipeline by Stage</h2>
          <p className="text-sm text-gray-500 mt-1">
            {grandCount} active loan{grandCount === 1 ? '' : 's'} · {formatCurrency(grandVolume)} total volume
            {ctx.role !== 'admin' && ' · scoped to your loans'}
          </p>
        </div>
        <CsvDownloadButton fileName="pipeline-by-stage" headers={csvHeaders} rows={csvRows} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                <th className="pb-2 font-medium">Stage</th>
                <th className="pb-2 font-medium text-right">Loans</th>
                <th className="pb-2 font-medium text-right">Volume</th>
                <th className="pb-2 font-medium pl-6 w-1/3">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {stageRows.map(row => (
                <tr key={row.stage} className="border-b border-gray-100 last:border-b-0">
                  <td className="py-2.5 font-medium text-gray-900">{row.stage}</td>
                  <td className="py-2.5 text-right tabular-nums">{row.count}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-700">{formatCurrency(row.totalVolume)}</td>
                  <td className="py-2.5 pl-6">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(row.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="pt-3">Total</td>
                <td className="pt-3 text-right tabular-nums">{grandCount}</td>
                <td className="pt-3 text-right tabular-nums">{formatCurrency(grandVolume)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PortalShell>
  )
}
