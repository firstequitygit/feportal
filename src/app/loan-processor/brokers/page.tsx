import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { EditableContactList, type EditableContactRow } from '@/components/editable-contact-list'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

export default async function LoanProcessorBrokersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const lp = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null; is_ops_manager: boolean | null }>(
    adminClient, 'loan_processor', user.id
  )
  if (!lp) redirect('/login')

  // Ops managers see brokers across every active loan.
  const baseQuery = adminClient
    .from('loans')
    .select('broker_id, broker_id_2')
    .eq('archived', false)
  const { data: rows } = await (lp.is_ops_manager
    ? baseQuery
    : baseQuery.or(`loan_processor_id.eq.${lp.id},loan_processor_id_2.eq.${lp.id}`))

  const loanCountById = new Map<string, number>()
  for (const r of rows ?? []) {
    for (const id of [r.broker_id, r.broker_id_2]) {
      if (!id) continue
      loanCountById.set(id, (loanCountById.get(id) ?? 0) + 1)
    }
  }
  const ids = [...loanCountById.keys()]

  const { data: brokers } = ids.length > 0
    ? await adminClient.from('brokers').select('id, full_name, email, phone, company_name').in('id', ids).order('full_name')
    : { data: [] }

  const initial: EditableContactRow[] = (brokers ?? []).map(b => {
    const count = loanCountById.get(b.id) ?? 0
    return {
      id: b.id,
      full_name: b.full_name,
      email: b.email,
      phone: b.phone,
      company_name: b.company_name,
      subtitle: count > 0 ? `On ${count} of your loan${count === 1 ? '' : 's'}` : null,
    }
  })

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'loan_processor'

  return (
    <PortalShell userName={lp.full_name} userRole="Loan Processor" dashboardHref="/loan-processor/inbox" variant="loan-processor" maxWidth="max-w-3xl" impersonation={isImpersonating ? {
        kind: 'loan_processor',
        name: lp.full_name,
        exitHref: impersonationExitHref(),
      } : null}>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Brokers</h2>
      <p className="text-sm text-gray-500 mb-6">
        Every broker across every loan assigned to you. Click the pencil to correct
        a misspelling, update an email, change a phone number, or set a company.
      </p>
      <EditableContactList
        label="brokers"
        apiPath="/api/loan-processor/brokers"
        withCompany
        initialContacts={initial}
      />
    </PortalShell>
  )
}
