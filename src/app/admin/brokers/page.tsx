import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminContactList, type ContactRow } from '@/components/admin-contact-list'

export default async function AdminBrokersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const adminClient = createAdminClient()
  const [{ data: brokers }, { data: loanCounts }] = await Promise.all([
    adminClient.from('brokers').select('id, full_name, email, phone, company_name').order('full_name'),
    adminClient.from('loans').select('broker_id').not('broker_id', 'is', null),
  ])

  const counts = new Map<string, number>()
  for (const l of loanCounts ?? []) {
    if (l.broker_id) counts.set(l.broker_id, (counts.get(l.broker_id) ?? 0) + 1)
  }

  const rows: ContactRow[] = (brokers ?? []).map(b => ({
    id: b.id,
    full_name: b.full_name,
    email: b.email,
    phone: b.phone,
    company_name: b.company_name,
    loanCount: counts.get(b.id) ?? 0,
  }))

  return (
    <PortalShell userName={null} userRole="Administrator" dashboardHref="/admin" variant="admin" maxWidth="max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Brokers</h2>
      <p className="text-sm text-gray-500 mb-6">
        All brokers in the portal. Brokers are added via the &quot;Invite Broker&quot; button in the
        sidebar. Deleting a broker removes their portal login and clears them from any loans they
        were on — the loans themselves stay intact, with the borrower becoming the contact again.
      </p>
      <AdminContactList
        label="brokers"
        singular="broker"
        apiPath="/api/admin/brokers"
        initialContacts={rows}
      />
    </PortalShell>
  )
}
