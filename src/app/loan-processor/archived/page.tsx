import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

export default async function LoanProcessorArchivedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const lp = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null; is_ops_manager: boolean | null }>(
    adminClient, 'loan_processor', user.id
  )
  if (!lp) redirect('/login')

  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const idList = (archivedIds ?? []) as string[]

  // Ops managers see every archived loan; regular LPs only their assigned.
  const archivedQuery = idList.length > 0
    ? adminClient
        .from('loans')
        .select('*, borrowers!borrower_id(full_name, email)')
        .in('id', idList)
        .order('created_at', { ascending: false })
    : null
  const { data: loans } = archivedQuery
    ? await (lp.is_ops_manager
        ? archivedQuery
        : archivedQuery.or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`))
    : { data: [] }

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'loan_processor'

  return (
    <PortalShell userName={lp.full_name} userRole="Loan Processor" dashboardHref="/loan-processor" variant="loan-processor" impersonation={isImpersonating ? {
        kind: 'loan_processor',
        name: lp.full_name,
        exitHref: impersonationExitHref(),
      } : null}>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Archived Loans
        <span className="ml-2 text-base font-normal text-gray-400">{(loans ?? []).length} loan{(loans ?? []).length !== 1 ? 's' : ''}</span>
      </h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Archived Loans</CardTitle>
        </CardHeader>
        <CardContent>
          {(!loans || loans.length === 0) ? (
            <p className="text-sm text-gray-500 py-4">No archived loans assigned to you.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {loans.map((loan) => (
                <div key={loan.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 truncate">{loan.property_address ?? '—'}</p>
                      {loan.loan_status === 'cancelled' && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                          Cancelled
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      {loan.borrowers?.full_name ?? <span className="italic">Unassigned</span>}
                      {' · '}
                      {loan.loan_type ?? '—'}
                      {' · '}
                      {formatCurrency(loan.loan_amount)}
                    </p>
                    {loan.loan_status === 'cancelled' && loan.cancellation_reason && (
                      <p className="text-xs text-red-600 mt-1">
                        <span className="font-medium">Reason:</span> {loan.cancellation_reason}
                      </p>
                    )}
                  </div>
                  <Link
                    href={`/loan-processor/loans/${loan.id}`}
                    className="text-xs text-primary hover:opacity-80 shrink-0"
                  >
                    View →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
