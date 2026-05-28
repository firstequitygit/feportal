import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent } from '@/components/ui/card'
import { PortalShell } from '@/components/portal-shell'
import { LoanListSorted } from '@/components/loan-list-sorted'
import { AvailableLoans } from '@/components/available-loans'
import { Building2, Users, AlertCircle } from 'lucide-react'
import { type Loan, type OutstandingCounts } from '@/lib/types'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

export default async function LoanProcessorLoansPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const lp = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null; is_ops_manager: boolean | null }>(
    adminClient, 'loan_processor', user.id
  )
  if (!lp) redirect('/login')

  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  // Ops managers see every active loan; regular LPs only see ones assigned
  // to them. Same goes for the "available to claim" pool — ops managers
  // skip the claim section entirely (they don't need to claim).
  const myLoansQuery = adminClient
    .from('loans')
    .select(`
      *,
      borrowers!borrower_id(full_name, email),
      loan_officers!loan_officer_id(id, full_name),
      loan_processors!loan_processor_id(id, full_name),
      loan_details(cash_out_amount)
    `)
    .eq('archived', false)
    .order('created_at', { ascending: false })
  const scopedMyLoans = lp.is_ops_manager
    ? myLoansQuery
    : myLoansQuery.or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`)

  const [{ data: loans }, { data: unassignedLoansRaw }] = await Promise.all([
    scopedMyLoans,
    // Available to claim — ops managers don't claim, but the section is
    // hidden by client filter (see below) so we just return an empty list.
    lp.is_ops_manager
      ? Promise.resolve({ data: [] as Loan[] })
      : adminClient
          .from('loans')
          .select(`
            *,
            borrowers!borrower_id(full_name, email),
            loan_officers!loan_officer_id(id, full_name),
            loan_processors!loan_processor_id(id, full_name),
            loan_details(cash_out_amount)
          `)
          .or('loan_processor_id.is.null,loan_processor_id_2.is.null')
          .neq('pipeline_stage', 'Closed')
          .neq('pipeline_stage', 'New Application')
          .eq('archived', false)
          .order('created_at', { ascending: false }),
  ])

  // Exclude loans where this LP already occupies one of the slots
  const unassignedLoans = (unassignedLoansRaw ?? []).filter(
    l => l.loan_processor_id !== lp.id && l.loan_processor_id_2 !== lp.id
  )

  const loanIds = (loans ?? []).map((l: Loan) => l.id)

  const [outstandingRes, eventsRes] = await Promise.all([
    loanIds.length > 0
      ? adminClient.from('conditions').select('loan_id, assigned_to, status').in('loan_id', loanIds).or('status.eq.Outstanding,status.eq.Rejected,status.eq.Received')
      : Promise.resolve({ data: [] }),
    loanIds.length > 0
      ? adminClient.from('loan_events').select('loan_id, created_at').in('loan_id', loanIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  // For LP, Received items are no longer actionable (UW needs to verify) — bucket as team, not "you".
  const outstandingMap: Record<string, OutstandingCounts> = {}
  for (const c of outstandingRes.data ?? []) {
    const counts = outstandingMap[c.loan_id] ?? { you: 0, borrower: 0, team: 0, total: 0 }
    const isActionableForLp = c.assigned_to === 'loan_processor' && (c.status === 'Outstanding' || c.status === 'Rejected')
    if (isActionableForLp)                     counts.you++
    else if (c.assigned_to === 'borrower')     counts.borrower++
    else                                        counts.team++
    counts.total++
    outstandingMap[c.loan_id] = counts
  }

  const lastUpdatedMap: Record<string, string> = {}
  for (const e of eventsRes.data ?? []) {
    if (!lastUpdatedMap[e.loan_id]) lastUpdatedMap[e.loan_id] = e.created_at
  }

  const activeLoans = (loans ?? []).filter((l: Loan) => l.pipeline_stage !== 'Closed' && !archivedSet.has(l.id))
  const closedLoans = (loans ?? []).filter((l: Loan) => l.pipeline_stage === 'Closed' && !archivedSet.has(l.id))

  const totalLoans = activeLoans.length + closedLoans.length
  const uniqueBorrowers = new Set((loans ?? []).filter(l => !archivedSet.has(l.id) && l.borrower_id).map(l => l.borrower_id)).size
  const youOutstanding = Object.values(outstandingMap).reduce((s, c) => s + c.you, 0)
  const totalOutstanding = Object.values(outstandingMap).reduce((s, c) => s + c.total, 0)

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'loan_processor'

  return (
    <PortalShell userName={lp.full_name} userRole="Loan Processor" dashboardHref="/loan-processor/inbox" variant="loan-processor" impersonation={isImpersonating ? {
        kind: 'loan_processor',
        name: lp.full_name,
        exitHref: impersonationExitHref(),
      } : null}>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Loans</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-900">{totalLoans}</p>
                <p className="text-sm text-gray-500 mt-0.5">Total Loans</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <Users className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-gray-900">{uniqueBorrowers}</p>
                <p className="text-sm text-gray-500 mt-0.5">Borrowers</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-red-600">{youOutstanding}</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Outstanding for you
                  {totalOutstanding > youOutstanding && (
                    <span className="text-gray-400"> · {totalOutstanding} total</span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <AvailableLoans
        loans={(unassignedLoans ?? []).filter(l => !archivedSet.has(l.id))}
        claimEndpoint="/api/loan-processor/claim"
        role="loan_processor"
      />
      <LoanListSorted
        activeLoans={activeLoans}
        closedLoans={closedLoans}
        outstandingMap={outstandingMap}
        lastUpdatedMap={lastUpdatedMap}
        linkPrefix="/loan-processor"
      />
    </PortalShell>
  )
}
