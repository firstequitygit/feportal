import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { EditableContactList, type EditableContactRow } from '@/components/editable-contact-list'

export default async function LoanOfficerBrokersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: lo } = await adminClient
    .from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!lo) redirect('/login')

  const { data: rows } = await adminClient
    .from('loans')
    .select('broker_id, broker_id_2')
    .eq('loan_officer_id', lo.id)
    .eq('archived', false)

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

  return (
    <PortalShell userName={lo.full_name} userRole="Loan Officer" dashboardHref="/loan-officer/inbox" variant="loan-officer" maxWidth="max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Brokers</h2>
      <p className="text-sm text-gray-500 mb-6">
        Every broker across every loan assigned to you. Click the pencil to correct
        a misspelling, update an email, change a phone number, or set a company.
      </p>
      <EditableContactList
        label="brokers"
        apiPath="/api/loan-officer/brokers"
        withCompany
        initialContacts={initial}
      />
    </PortalShell>
  )
}
