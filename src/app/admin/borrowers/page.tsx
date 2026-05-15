import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminContactList, type ContactRow } from '@/components/admin-contact-list'

export default async function AdminBorrowersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const adminClient = createAdminClient()
  const [{ data: borrowers }, { data: loanCounts }] = await Promise.all([
    adminClient.from('borrowers').select('id, full_name, email, phone').order('full_name'),
    adminClient.from('loans').select('borrower_id').not('borrower_id', 'is', null),
  ])

  // Tally how many loans each borrower is on (for the delete-confirm warning)
  const counts = new Map<string, number>()
  for (const l of loanCounts ?? []) {
    if (l.borrower_id) counts.set(l.borrower_id, (counts.get(l.borrower_id) ?? 0) + 1)
  }

  const rows: ContactRow[] = (borrowers ?? []).map(b => ({
    id: b.id,
    full_name: b.full_name,
    email: b.email,
    phone: b.phone,
    loanCount: counts.get(b.id) ?? 0,
  }))

  return (
    <PortalShell userName={null} userRole="Administrator" dashboardHref="/admin" variant="admin" maxWidth="max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Borrowers</h2>
      <p className="text-sm text-gray-500 mb-6">
        All borrowers in the portal. Adding borrowers happens via JotForm intake or the
        &quot;Invite Borrower&quot; button. Deleting a borrower removes their portal login and
        clears them from any loans they were on — the loans themselves stay intact.
      </p>
      <AdminContactList
        label="borrowers"
        singular="borrower"
        apiPath="/api/admin/borrowers"
        initialContacts={rows}
      />
    </PortalShell>
  )
}
