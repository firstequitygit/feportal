import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { LoBrokersGrid, type LoBrokerRow } from './lo-brokers-grid'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

export default async function LoanOfficerBrokersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const lo = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
    adminClient, 'loan_officer', user.id
  )
  if (!lo) redirect('/login')

  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address, pipeline_stage, updated_at, broker_id, broker_id_2')
    .eq('loan_officer_id', lo.id)
    .eq('archived', false)
    .order('updated_at', { ascending: false })

  const counts = new Map<string, number>()
  const mostRecent = new Map<string, { id: string; pipeline_stage: string | null; updated_at: string | null }>()
  for (const l of loans ?? []) {
    for (const bid of [l.broker_id, l.broker_id_2]) {
      if (!bid) continue
      counts.set(bid, (counts.get(bid) ?? 0) + 1)
      if (!mostRecent.has(bid)) {
        mostRecent.set(bid, { id: l.id, pipeline_stage: l.pipeline_stage, updated_at: l.updated_at })
      }
    }
  }
  const brokerIds = [...counts.keys()]

  const { data: brokers } = brokerIds.length > 0
    ? await adminClient
        .from('brokers')
        .select('id, full_name, email, phone, company_name')
        .in('id', brokerIds)
        .order('full_name')
    : { data: [] }

  const rows: LoBrokerRow[] = (brokers ?? []).map(b => {
    const recent = mostRecent.get(b.id) ?? null
    return {
      id: b.id,
      full_name: b.full_name,
      email: b.email,
      phone: b.phone,
      company_name: b.company_name,
      loan_count: counts.get(b.id) ?? 0,
      most_recent_loan_id: recent?.id ?? null,
      last_loan_stage: recent?.pipeline_stage ?? null,
      last_loan_activity: recent?.updated_at ?? null,
    }
  })

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'loan_officer'

  return (
    <PortalShell userName={lo.full_name} userRole="Loan Officer" dashboardHref="/loan-officer/inbox" variant="loan-officer" maxWidth="max-w-screen-2xl" impersonation={isImpersonating ? {
        kind: 'loan_officer',
        name: lo.full_name,
        exitHref: impersonationExitHref(),
      } : null}>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Brokers</h2>
      <p className="text-sm text-gray-500 mb-6">
        Every broker across every loan assigned to you. Click a cell to edit contact info
        or company name inline, or use the chevron to jump to their most recent loan.
      </p>
      <LoBrokersGrid initialRows={rows} />
    </PortalShell>
  )
}
