import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { LoanListSorted } from '@/components/loan-list-sorted'
import { AvailableLoans } from '@/components/available-loans'
import { type Loan, type OutstandingCounts } from '@/lib/types'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

export default async function UnderwriterLoansPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const uw = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
    adminClient, 'underwriter', user.id
  )
  if (!uw) redirect('/login')

  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  const [{ data: loans }, { data: unassignedLoans }] = await Promise.all([
    adminClient
      .from('loans')
      .select(`
        *,
        borrowers!borrower_id(full_name, email),
        loan_officers!loan_officer_id(id, full_name),
        loan_processors!loan_processor_id(id, full_name),
        loan_details(cash_out_amount)
      `)
      .eq('underwriter_id', uw.id)
      .eq('archived', false)
      .order('created_at', { ascending: false }),
    // UWs can only claim once a loan is in Pre-Underwriting or later.
    // New Application + Processing aren't ready for underwriting yet.
    adminClient
      .from('loans')
      .select(`
        *,
        borrowers!borrower_id(full_name, email),
        loan_officers!loan_officer_id(id, full_name),
        loan_processors!loan_processor_id(id, full_name),
        loan_details(cash_out_amount)
      `)
      .is('underwriter_id', null)
      .in('pipeline_stage', ['Pre-Underwriting', 'Underwriting', 'Conditionally Approved', 'Approved'])
      .eq('archived', false)
      .order('created_at', { ascending: false }),
  ])

  const loanIds = (loans ?? []).map((l: Loan) => l.id)

  const [outstandingRes, eventsRes] = await Promise.all([
    loanIds.length > 0
      ? adminClient.from('conditions').select('loan_id, assigned_to').in('loan_id', loanIds).or('status.eq.Outstanding,status.eq.Rejected,status.eq.Received')
      : Promise.resolve({ data: [] }),
    loanIds.length > 0
      ? adminClient.from('loan_events').select('loan_id, created_at').in('loan_id', loanIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  const outstandingMap: Record<string, OutstandingCounts> = {}
  for (const c of outstandingRes.data ?? []) {
    const counts = outstandingMap[c.loan_id] ?? { you: 0, borrower: 0, team: 0, total: 0 }
    if (c.assigned_to === 'underwriter')       counts.you++
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

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'underwriter'

  return (
    <PortalShell userName={uw.full_name} userRole="Underwriter" dashboardHref="/underwriter/inbox" variant="underwriter" impersonation={isImpersonating ? {
        kind: 'underwriter',
        name: uw.full_name,
        exitHref: impersonationExitHref(),
      } : null}>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Loans</h2>
      <AvailableLoans
        loans={(unassignedLoans ?? []).filter(l => !archivedSet.has(l.id))}
        claimEndpoint="/api/underwriter/claim"
        role="underwriter"
      />
      <LoanListSorted
        activeLoans={activeLoans}
        closedLoans={closedLoans}
        outstandingMap={outstandingMap}
        lastUpdatedMap={lastUpdatedMap}
        linkPrefix="/underwriter"
        groupByLoanOfficer
      />
    </PortalShell>
  )
}
