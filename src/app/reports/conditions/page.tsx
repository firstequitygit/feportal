import Link from 'next/link'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/lib/supabase/admin'
import { getReportContext, roleLabel, loanDetailHref } from '@/lib/reports/auth'
import { CsvDownloadButton } from '@/components/reports/csv-download-button'
import { ArrowLeft } from 'lucide-react'
import { CONDITION_CATEGORIES, type AssignedTo } from '@/lib/types'

function assignedToLabel(a: AssignedTo): string {
  switch (a) {
    case 'borrower':       return 'Borrower'
    case 'loan_officer':   return 'Loan Officer'
    case 'loan_processor': return 'Loan Processor'
    case 'underwriter':    return 'Underwriter'
  }
}

interface ConditionRow {
  id: string
  loan_id: string
  title: string
  description: string | null
  status: string
  assigned_to: AssignedTo
  category: string | null
  created_at: string
  loans: { id: string; property_address: string | null } | null
}

export default async function ConditionsReportPage() {
  const ctx = await getReportContext()
  const adminClient = createAdminClient()

  // Scope: build a set of loan ids the user can see, then filter conditions to those.
  let loanIdsScope: string[] | null = null
  if (ctx.loanScopeColumn && ctx.loanScopeId) {
    const { data: scopedLoans } = await adminClient
      .from('loans')
      .select('id')
      .eq(ctx.loanScopeColumn, ctx.loanScopeId)
    loanIdsScope = ((scopedLoans ?? []) as { id: string }[]).map(l => l.id)
  }

  let cq = adminClient
    .from('conditions')
    .select('id, loan_id, title, description, status, assigned_to, category, created_at, loans(id, property_address)')
    .in('status', ['Outstanding', 'Rejected'])
    .order('created_at', { ascending: true })

  if (loanIdsScope !== null) {
    if (loanIdsScope.length === 0) {
      // User has no loans; render empty result without querying
      cq = cq.in('loan_id', ['00000000-0000-0000-0000-000000000000'])
    } else {
      cq = cq.in('loan_id', loanIdsScope)
    }
  }

  const { data: rawConditions } = await cq
  const conditions = (rawConditions ?? []) as unknown as ConditionRow[]

  // Group by category, summarize by assignee within
  const byCategory = new Map<string, ConditionRow[]>()
  for (const c of conditions) {
    const key = c.category ?? '__uncategorized__'
    const arr = byCategory.get(key) ?? []
    arr.push(c)
    byCategory.set(key, arr)
  }

  const categoryOrder = [...CONDITION_CATEGORIES.map(c => c.value), '__uncategorized__']
  const groups = categoryOrder
    .map(cat => {
      const items = byCategory.get(cat) ?? []
      const label = cat === '__uncategorized__'
        ? 'Uncategorized'
        : (CONDITION_CATEGORIES.find(c => c.value === cat)?.label ?? cat)
      return { cat, label, items }
    })
    .filter(g => g.items.length > 0)

  // Assignee summary (across all conditions, regardless of category)
  const byAssignee = new Map<AssignedTo, number>()
  for (const c of conditions) {
    byAssignee.set(c.assigned_to, (byAssignee.get(c.assigned_to) ?? 0) + 1)
  }

  const csvHeaders = ['Property Address', 'Category', 'Condition', 'Status', 'Assigned To', 'Days Open']
  const csvRows = conditions.map(c => {
    const daysOpen = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86_400_000)
    const catLabel = c.category
      ? (CONDITION_CATEGORIES.find(x => x.value === c.category)?.label ?? c.category)
      : 'Uncategorized'
    return [
      c.loans?.property_address ?? '',
      catLabel,
      c.title,
      c.status,
      assignedToLabel(c.assigned_to),
      daysOpen,
    ]
  })

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
          <h2 className="text-2xl font-bold text-gray-900">Outstanding Conditions</h2>
          <p className="text-sm text-gray-500 mt-1">
            {conditions.length} condition{conditions.length === 1 ? '' : 's'} open across all active loans
            {ctx.role !== 'admin' && ' assigned to you'}
          </p>
        </div>
        <CsvDownloadButton fileName="outstanding-conditions" headers={csvHeaders} rows={csvRows} />
      </div>

      {/* Assignee summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(['borrower', 'loan_officer', 'loan_processor', 'underwriter'] as AssignedTo[]).map(a => (
          <Card key={a}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-medium">{assignedToLabel(a)}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{byAssignee.get(a) ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-gray-500 italic text-center">
              No outstanding conditions. 🎉
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <Card key={g.cat}>
              <CardHeader>
                <CardTitle className="text-base">
                  {g.label}
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    {g.items.length} open
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                      <th className="pb-2 font-medium">Property</th>
                      <th className="pb-2 font-medium">Condition</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Assigned</th>
                      <th className="pb-2 font-medium text-right">Days Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(c => {
                      const daysOpen = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86_400_000)
                      const loanHref = c.loans ? loanDetailHref(ctx.role, c.loans.id) : null
                      return (
                        <tr key={c.id} className="border-b border-gray-100 last:border-b-0">
                          <td className="py-2.5 font-medium text-gray-900">
                            {loanHref ? (
                              <Link href={loanHref} className="hover:text-primary">
                                {c.loans?.property_address ?? '—'}
                              </Link>
                            ) : (c.loans?.property_address ?? '—')}
                          </td>
                          <td className="py-2.5 text-gray-700">{c.title}</td>
                          <td className="py-2.5">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              c.status === 'Rejected' ? 'bg-red-100 text-red-800' : 'bg-red-50 text-red-700'
                            }`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="py-2.5 text-gray-700">{assignedToLabel(c.assigned_to)}</td>
                          <td className="py-2.5 text-right tabular-nums">
                            <span className={daysOpen >= 30 ? 'text-red-600 font-semibold' :
                                             daysOpen >= 14 ? 'text-amber-600' : ''}>
                              {daysOpen}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PortalShell>
  )
}
