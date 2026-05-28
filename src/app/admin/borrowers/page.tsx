import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCookieImpersonationForShell } from '@/lib/impersonate'
import { PortalShell } from '@/components/portal-shell'
import { AdminBorrowersGrid, type AdminBorrowerRow } from './admin-borrowers-grid'

export default async function AdminBorrowersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id, full_name, is_super').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const adminClient = createAdminClient()
  const impersonation = await getCookieImpersonationForShell(adminClient, user.id)
  const [{ data: borrowers }, { data: loans }, { data: officers }] = await Promise.all([
    adminClient.from('borrowers').select('id, full_name, email, phone, created_at, auth_user_id').order('full_name'),
    adminClient.from('loans').select('borrower_id, borrower_id_2, borrower_id_3, borrower_id_4, loan_officer_id'),
    adminClient.from('loan_officers').select('id, full_name'),
  ])

  const officerName = new Map<string, string>((officers ?? []).map(o => [o.id, o.full_name ?? '—']))

  // For each borrower, count the loans they appear on (any of 4 slots) and collect
  // the unique set of loan officers across those loans.
  const counts = new Map<string, number>()
  const officersByBorrower = new Map<string, Set<string>>()
  for (const l of loans ?? []) {
    const bids = [l.borrower_id, l.borrower_id_2, l.borrower_id_3, l.borrower_id_4]
      .filter((x): x is string => !!x)
    for (const bid of bids) {
      counts.set(bid, (counts.get(bid) ?? 0) + 1)
      if (l.loan_officer_id) {
        const name = officerName.get(l.loan_officer_id)
        if (name) {
          if (!officersByBorrower.has(bid)) officersByBorrower.set(bid, new Set())
          officersByBorrower.get(bid)!.add(name)
        }
      }
    }
  }

  const rows: AdminBorrowerRow[] = (borrowers ?? []).map(b => ({
    id: b.id,
    full_name: b.full_name,
    email: b.email,
    phone: b.phone,
    created_at: b.created_at,
    has_auth: !!b.auth_user_id,
    loan_count: counts.get(b.id) ?? 0,
    loan_officers: [...(officersByBorrower.get(b.id) ?? [])].sort(),
  }))

  return (
    <PortalShell userName={admin.full_name} userRole="Administrator" dashboardHref="/admin" variant="admin" isSuperAdmin={admin.is_super ?? false} impersonation={impersonation} maxWidth="max-w-screen-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Borrowers</h2>
      <p className="text-sm text-gray-500 mb-6">
        All borrowers in the portal. Adding borrowers happens via JotForm intake or the
        &quot;Invite Borrower&quot; button. Deleting a borrower removes their portal login and
        clears them from any loans they were on — the loans themselves stay intact.
      </p>
      <AdminBorrowersGrid initialRows={rows} />
    </PortalShell>
  )
}
