import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminBrokersGrid, type AdminBrokerRow } from './admin-brokers-grid'
import { resolveImpersonation } from '@/lib/impersonate'

export default async function AdminBrokersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id, full_name, is_super').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const adminClient = createAdminClient()
  const [{ data: brokers }, { data: loans }, { data: officers }] = await Promise.all([
    adminClient.from('brokers').select('id, full_name, email, phone, company_name, created_at, auth_user_id').order('full_name'),
    adminClient.from('loans').select('broker_id, broker_id_2, loan_officer_id'),
    adminClient.from('loan_officers').select('id, full_name'),
  ])

  const officerName = new Map<string, string>((officers ?? []).map(o => [o.id, o.full_name ?? '—']))

  const counts = new Map<string, number>()
  const officersByBroker = new Map<string, Set<string>>()
  for (const l of loans ?? []) {
    const bids = [l.broker_id, l.broker_id_2].filter((x): x is string => !!x)
    for (const bid of bids) {
      counts.set(bid, (counts.get(bid) ?? 0) + 1)
      if (l.loan_officer_id) {
        const name = officerName.get(l.loan_officer_id)
        if (name) {
          if (!officersByBroker.has(bid)) officersByBroker.set(bid, new Set())
          officersByBroker.get(bid)!.add(name)
        }
      }
    }
  }

  const rows: AdminBrokerRow[] = (brokers ?? []).map(b => ({
    id: b.id,
    full_name: b.full_name,
    email: b.email,
    phone: b.phone,
    company_name: b.company_name,
    created_at: b.created_at,
    has_auth: !!b.auth_user_id,
    loan_count: counts.get(b.id) ?? 0,
    loan_officers: [...(officersByBroker.get(b.id) ?? [])].sort(),
  }))

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const showViewAsTrigger = !impersonation

  return (
    <PortalShell userName={admin.full_name} userRole="Administrator" dashboardHref="/admin" variant="admin" isSuperAdmin={admin.is_super ?? false} maxWidth="max-w-7xl" showViewAsTrigger={showViewAsTrigger}>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Brokers</h2>
      <p className="text-sm text-gray-500 mb-6">
        All brokers in the portal. Brokers are added via the &quot;Invite Broker&quot; button in the
        sidebar. Deleting a broker removes their portal login and clears them from any loans they
        were on — the loans themselves stay intact, with the borrower becoming the contact again.
      </p>
      <AdminBrokersGrid initialRows={rows} />
    </PortalShell>
  )
}
