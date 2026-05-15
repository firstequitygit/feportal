import Link from 'next/link'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/lib/supabase/admin'
import { getReportContext, roleLabel, loanDetailHref } from '@/lib/reports/auth'
import { CsvDownloadButton } from '@/components/reports/csv-download-button'
import { AgingThresholdFilter } from '@/components/reports/aging-threshold-filter'
import { ArrowLeft } from 'lucide-react'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

interface HistoryRow {
  loan_id: string
  stage: string
  entered_at: string
  exited_at: string | null
}

interface LoanRow {
  id: string
  property_address: string | null
  pipeline_stage: string | null
  loan_amount: number | null
  loan_officer_id: string | null
  loan_officers: { full_name: string } | null
  created_at: string
}

export default async function AgingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const ctx = await getReportContext()
  const { days: daysParam } = await searchParams
  const days = Math.max(1, parseInt(daysParam ?? '14', 10) || 14)
  const cutoffMs = Date.now() - days * 86_400_000

  const adminClient = createAdminClient()

  // Fetch active loans (non-archived, non-closed), scoped to user
  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set((archivedIds ?? []).map((r: { loan_id: string }) => r.loan_id))

  let q = adminClient
    .from('loans')
    .select('id, property_address, pipeline_stage, loan_amount, loan_officer_id, created_at, loan_officers(full_name)')
    .neq('pipeline_stage', 'Closed')
  if (ctx.loanScopeColumn && ctx.loanScopeId) {
    q = q.eq(ctx.loanScopeColumn, ctx.loanScopeId)
  }
  const { data: rawLoans } = await q
  const loans = ((rawLoans ?? []) as unknown as LoanRow[]).filter(l => !archivedSet.has(l.id))

  // Lookup most recent stage-entry timestamp per loan from loan_stage_history.
  // Falls back to loans.created_at if there's no history row for the loan.
  let history: HistoryRow[] = []
  if (loans.length > 0) {
    const { data } = await adminClient
      .from('loan_stage_history')
      .select('loan_id, stage, entered_at, exited_at')
      .in('loan_id', loans.map(l => l.id))
      .is('exited_at', null)
    history = (data ?? []) as HistoryRow[]
  }
  const stageEnteredAtByLoan = new Map<string, string>()
  for (const h of history) stageEnteredAtByLoan.set(h.loan_id, h.entered_at)

  // Compute days in current stage, filter by threshold
  const rows = loans
    .map(l => {
      const enteredAt = stageEnteredAtByLoan.get(l.id) ?? l.created_at
      const enteredMs = new Date(enteredAt).getTime()
      const daysInStage = Math.floor((Date.now() - enteredMs) / 86_400_000)
      return {
        id: l.id,
        property_address: l.property_address,
        pipeline_stage: l.pipeline_stage,
        loan_amount: l.loan_amount,
        loanOfficer: l.loan_officers?.full_name ?? '(Unassigned)',
        enteredAt,
        enteredMs,
        daysInStage,
      }
    })
    .filter(r => r.enteredMs < cutoffMs)
    .sort((a, b) => b.daysInStage - a.daysInStage)

  const csvHeaders = ['Property Address', 'Stage', 'Days in Stage', 'Loan Officer', 'Loan Amount']
  const csvRows = rows.map(r => [
    r.property_address ?? '',
    r.pipeline_stage ?? '',
    r.daysInStage,
    r.loanOfficer,
    r.loan_amount ?? 0,
  ])

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
          <h2 className="text-2xl font-bold text-gray-900">Aging / Stuck Loans</h2>
          <p className="text-sm text-gray-500 mt-1">
            {rows.length} loan{rows.length === 1 ? '' : 's'} stuck in their current stage for more than {days} days
            {ctx.role !== 'admin' && ' · scoped to your loans'}
          </p>
        </div>
        <CsvDownloadButton fileName={`aging-${days}-days`} headers={csvHeaders} rows={csvRows} />
      </div>

      <AgingThresholdFilter current={days} options={[7, 14, 30, 60, 90]} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stuck Loans</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500 italic py-6 text-center">
              No loans have been in their current stage longer than {days} days.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                  <th className="pb-2 font-medium">Property</th>
                  <th className="pb-2 font-medium">Stage</th>
                  <th className="pb-2 font-medium text-right">Days</th>
                  <th className="pb-2 font-medium">Loan Officer</th>
                  <th className="pb-2 font-medium text-right">Loan Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2.5 font-medium text-gray-900">
                      <Link href={loanDetailHref(ctx.role, r.id)} className="hover:text-primary">
                        {r.property_address ?? '—'}
                      </Link>
                    </td>
                    <td className="py-2.5 text-gray-700">{r.pipeline_stage ?? '—'}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      <span className={r.daysInStage >= 60 ? 'text-red-600 font-semibold' :
                                       r.daysInStage >= 30 ? 'text-amber-600 font-medium' : ''}>
                        {r.daysInStage}
                      </span>
                    </td>
                    <td className="py-2.5 text-gray-700">{r.loanOfficer}</td>
                    <td className="py-2.5 text-right tabular-nums text-gray-700">{formatCurrency(r.loan_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
