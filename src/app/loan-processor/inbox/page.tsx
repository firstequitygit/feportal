import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { InboxView, type InboxItem } from '@/components/inbox-view'
import { DashboardStats } from '@/components/dashboard-stats'
import { computeDashboardMetrics } from '@/lib/dashboard-metrics'

export default async function LoanProcessorInbox() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const { data: lp } = await adminClient
    .from('loan_processors')
    .select('*')
    .eq('auth_user_id', user.id)
    .single()

  if (!lp) redirect('/login')

  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address, pipeline_stage, loan_number, loan_amount, closed_at')
    .or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`)
    .eq('archived', false)

  // Closed-in-last-12-months — archived OR not.
  const oneYearAgoIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
  const { data: closedTrailing } = await adminClient
    .from('loans')
    .select('loan_amount')
    .or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`)
    .eq('pipeline_stage', 'Closed')
    .gte('closed_at', oneYearAgoIso)

  const activeLoans = (loans ?? []).filter(l => l.pipeline_stage !== 'Closed')
  const loanIds = activeLoans.map(l => l.id)
  const loanMap = new Map(activeLoans.map(l => [l.id, l]))

  const metrics = await computeDashboardMetrics(adminClient, {
    activeLoans: loans ?? [],
    closedLoansTrailing12: closedTrailing ?? [],
    conditionAssignee: 'loan_processor',
  })

  const { data: conditions } = loanIds.length > 0
    ? await adminClient
        .from('conditions')
        .select('id, loan_id, title, description, status, category, rejection_reason, created_at, updated_at')
        .in('loan_id', loanIds)
        .eq('assigned_to', 'loan_processor')
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

  return (
    <PortalShell
      userName={lp.full_name}
      userRole="Loan Processor"
      dashboardHref="/loan-processor/inbox"
      variant="loan-processor"
    >
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>
      <DashboardStats {...metrics} />
      <InboxView items={items} role="loan_processor" linkPrefix="/loan-processor" />
    </PortalShell>
  )
}
