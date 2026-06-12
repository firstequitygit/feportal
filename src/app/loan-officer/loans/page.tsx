import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { LoanListSorted } from '@/components/loan-list-sorted'
import { DashboardStats } from '@/components/dashboard-stats'
import { computeDashboardMetrics } from '@/lib/dashboard-metrics'
import { fetchLatestStaffNotesByLoan } from '@/lib/fetch-closer-notes'
import { fetchLoanActivityMaps } from '@/lib/loans/fetch-loan-activity'
import { type Loan, type OutstandingCounts } from '@/lib/types'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'
import { getEffectiveStaffContext } from '@/lib/staff-context'

export default async function LoanOfficerLoansPage() {
  const ctx = await getEffectiveStaffContext()
  if (!ctx) redirect('/login')
  // Allow LO pages when in LO view OR when admin (admin retains universal
  // access via View-As; getEffectiveRoleRow below applies the per-row gate).
  if (ctx.active_kind !== 'loan_officer' && !ctx.staff_user.is_admin) {
    redirect('/login')
  }

  const adminClient = createAdminClient()

  const lo = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
    adminClient, 'loan_officer', ctx.staff_user.auth_user_id
  )
  if (!lo) redirect('/login')

  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  // LOs are auto-assigned at Pipedrive sync time (deal owner → loan_officer_id),
  // so there's no "Available to Claim" pool for them — they just see what
  // they own. LPs and UWs still go through the claim flow.
  //
  // Two parallel queries:
  //  - active loans: drives the list + the "active" half of the dashboard tiles
  //  - closed-in-last-12-months: archived OR not (closed loans auto-archive
  //    30 days post-close, so we have to look past the archived flag to
  //    populate the "Closed (Last 12 Months)" tile)
  const oneYearAgoIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: loans }, { data: closedTrailing }] = await Promise.all([
    adminClient
      .from('loans')
      .select(`
        *,
        borrowers!borrower_id(full_name, email),
        loan_officers!loan_officer_id(id, full_name),
        loan_processors!loan_processor_id(id, full_name),
        loan_details(cash_out_amount)
      `)
      .eq('loan_officer_id', lo.id)
      .eq('archived', false)
      .order('created_at', { ascending: false }),
    adminClient
      .from('loans')
      .select('loan_amount')
      .eq('loan_officer_id', lo.id)
      .eq('pipeline_stage', 'Closed')
      .gte('closed_at', oneYearAgoIso),
  ])

  const loanIds = (loans ?? []).map((l: Loan) => l.id)

  const [outstandingRes, activityMaps] = await Promise.all([
    loanIds.length > 0
      ? adminClient.from('conditions').select('loan_id, assigned_to, status').in('loan_id', loanIds).or('status.eq.Outstanding,status.eq.Rejected,status.eq.Received,status.eq.Under Review')
      : Promise.resolve({ data: [] }),
    fetchLoanActivityMaps(adminClient, loanIds),
  ])
  const { lastUpdatedMap, roleActivityMap } = activityMaps

  // For LO, Received + Under Review items are no longer actionable (UW
  // needs to verify) — bucket as team, not "you".
  const outstandingMap: Record<string, OutstandingCounts> = {}
  for (const c of outstandingRes.data ?? []) {
    const counts = outstandingMap[c.loan_id] ?? { you: 0, borrower: 0, team: 0, total: 0 }
    const isActionableForLo = c.assigned_to === 'loan_officer' && (c.status === 'Outstanding' || c.status === 'Rejected')
    if (isActionableForLo)                     counts.you++
    else if (c.assigned_to === 'borrower')     counts.borrower++
    else                                        counts.team++
    counts.total++
    outstandingMap[c.loan_id] = counts
  }

  const activeLoans = (loans ?? []).filter((l: Loan) => l.pipeline_stage !== 'Closed' && !archivedSet.has(l.id))
  const closedLoans = (loans ?? []).filter((l: Loan) => l.pipeline_stage === 'Closed' && !archivedSet.has(l.id))

  // Dashboard tile metrics — same set the Inbox used to render. Now lives
  // at the top of the Loans page; the Inbox is just the inbox.
  const metrics = await computeDashboardMetrics(adminClient, {
    activeLoans: loans ?? [],
    closedLoansTrailing12: closedTrailing ?? [],
    conditionAssignee: 'loan_officer',
  })

  // Pre-fetch the most recent Closer Notes entry per loan so the card
  // can surface it inline. One query, scoped to this LO's loan ids.
  const latestNotesByLoan = await fetchLatestStaffNotesByLoan(adminClient, loanIds)

  const impersonation = await resolveImpersonation(adminClient, ctx.staff_user.auth_user_id, undefined)
  const isImpersonating = impersonation?.kind === 'loan_officer'

  return (
    <PortalShell userName={lo.full_name} userRole="Loan Officer" dashboardHref="/loan-officer/inbox" variant="loan-officer" maxWidth="max-w-screen-2xl" staffContext={ctx} impersonation={isImpersonating ? {
        kind: 'loan_officer',
        name: lo.full_name,
        exitHref: impersonationExitHref(),
      } : null}>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>
      <DashboardStats {...metrics} />
      <h3 className="text-xl font-bold text-gray-900 mt-10 mb-4">Loans</h3>
      <LoanListSorted
        activeLoans={activeLoans}
        closedLoans={closedLoans}
        outstandingMap={outstandingMap}
        lastUpdatedMap={lastUpdatedMap}
        latestNotesByLoan={latestNotesByLoan}
        roleActivityMap={roleActivityMap}
        // LOs track processor progress — their default sort is by the
        // LP's last update (stalest first), per Adam's spec.
        defaultSort={{ sort: 'lp_activity', dir: 'asc' }}
        linkPrefix="/loan-officer"
        hideLoanOfficerDimensions
      />
    </PortalShell>
  )
}
