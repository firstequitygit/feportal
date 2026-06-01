import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { InboxView, type InboxItem } from '@/components/inbox-view'
import { DashboardStats } from '@/components/dashboard-stats'
import { computeDashboardMetrics } from '@/lib/dashboard-metrics'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'
import { fetchMentionsForRole, resolveRoleIdent } from '@/lib/fetch-mentions'
import { MentionsCard } from '@/components/mentions-card'

export default async function LoanOfficerInbox() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const lo = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
    adminClient, 'loan_officer', user.id
  )
  if (!lo) redirect('/login')

  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  // Active loans (non-archived) — drives the inbox and pipeline tiles.
  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address, pipeline_stage, loan_number, loan_amount, closed_at')
    .eq('loan_officer_id', lo.id)
    .eq('archived', false)

  // Closed-in-last-12-months — archived OR not (closed loans auto-archive
  // 30 days post-close, so we have to look past the archived flag for this).
  const oneYearAgoIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
  const { data: closedTrailing } = await adminClient
    .from('loans')
    .select('loan_amount')
    .eq('loan_officer_id', lo.id)
    .eq('pipeline_stage', 'Closed')
    .gte('closed_at', oneYearAgoIso)

  const activeLoans = (loans ?? []).filter(l => l.pipeline_stage !== 'Closed')
  const loanIds = activeLoans.map(l => l.id)
  const loanMap = new Map(activeLoans.map(l => [l.id, l]))

  const metrics = await computeDashboardMetrics(adminClient, {
    activeLoans: loans ?? [],
    closedLoansTrailing12: closedTrailing ?? [],
    conditionAssignee: 'loan_officer',
  })

  const { data: conditions } = loanIds.length > 0
    ? await adminClient
        .from('conditions')
        .select('id, loan_id, title, description, status, category, rejection_reason, created_at, updated_at')
        .in('loan_id', loanIds)
        .eq('assigned_to', 'loan_officer')
    : { data: [] }

  const items: InboxItem[] = (conditions ?? []).map(c => {
    const loan = loanMap.get(c.loan_id)
    return {
      id: c.id,
      loan_id: c.loan_id,
      title: c.title,
      description: c.description,
      status: c.status,
      category: c.category,
      rejection_reason: c.rejection_reason,
      created_at: c.created_at,
      updated_at: c.updated_at,
      loan_address: loan?.property_address ?? null,
      loan_stage: loan?.pipeline_stage ?? null,
      loan_number: loan?.loan_number ?? null,
    }
  })

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'loan_officer'

  // Unread @mentions for this LO. resolveRoleIdent uses the live user
  // (not the impersonated one) so admin impersonators don't accidentally
  // mark the real LO's mentions read by browsing through View-As.
  const ident = await resolveRoleIdent(adminClient, user.id, 'loan_officer')
  const mentions = ident ? await fetchMentionsForRole(adminClient, ident, { limit: 20 }) : []

  return (
    <PortalShell
      userName={lo.full_name}
      userRole="Loan Officer"
      dashboardHref="/loan-officer/inbox"
      variant="loan-officer"
      impersonation={isImpersonating ? {
        kind: 'loan_officer',
        name: lo.full_name,
        exitHref: impersonationExitHref(),
      } : null}
    >
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>
      <DashboardStats {...metrics} />
      {mentions.length > 0 && (
        <div className="mt-6">
          <MentionsCard initial={mentions} linkPrefix="/loan-officer" />
        </div>
      )}
      <InboxView items={items} role="loan_officer" linkPrefix="/loan-officer" />
    </PortalShell>
  )
}
