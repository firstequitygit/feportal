import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { InboxView, type InboxItem } from '@/components/inbox-view'

export default async function UnderwriterInbox() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const { data: uw } = await adminClient
    .from('underwriters')
    .select('*')
    .eq('auth_user_id', user.id)
    .single()

  if (!uw) redirect('/login')

  const { data: archivedIds } = await adminClient.rpc('get_archived_loan_ids')
  const archivedSet = new Set<string>((archivedIds ?? []) as string[])

  const { data: loans } = await adminClient
    .from('loans')
    .select('id, property_address, pipeline_stage, loan_number')
    .eq('underwriter_id', uw.id)

  const activeLoans = (loans ?? []).filter(l => !archivedSet.has(l.id) && l.pipeline_stage !== 'Closed')
  const loanIds = activeLoans.map(l => l.id)
  const loanMap = new Map(activeLoans.map(l => [l.id, l]))

  // UW sees: anything assigned to them (their direct work)
  // PLUS any condition currently "Received" across the loan (the review queue)
  const { data: conditions } = loanIds.length > 0
    ? await adminClient
        .from('conditions')
        .select('id, loan_id, title, description, status, category, rejection_reason, created_at, updated_at')
        .in('loan_id', loanIds)
        .or('assigned_to.eq.underwriter,status.eq.Received')
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
      userName={uw.full_name}
      userRole="Underwriter"
      dashboardHref="/underwriter/inbox"
      variant="underwriter"
    >
      <InboxView items={items} role="underwriter" linkPrefix="/underwriter" />
    </PortalShell>
  )
}
