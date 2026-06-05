// Admin data tape — same wide pipeline view UW gets, useful for
// portfolio review and CSV exports from the admin side.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { DataTape } from '@/components/data-tape'
import { fetchDataTape } from '@/lib/fetch-data-tape'

export default async function AdminDataTapePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id, full_name')
    .eq('auth_user_id', user.id)
    .single()
  if (!admin) redirect('/login')

  const rows = await fetchDataTape(adminClient)

  return (
    <PortalShell
      userName={admin.full_name}
      userRole="Administrator"
      dashboardHref="/admin"
      variant="admin"
    >
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Data Tape</h2>
        <p className="text-sm text-gray-500 mt-1">
          Pipeline-wide loan view — same fields Alicyn tracks in Airtable.
          Excludes archived loans and New Application stage.
        </p>
      </div>
      <DataTape rows={rows} loanDetailHref={id => `/admin/loans/${id}`} />
    </PortalShell>
  )
}
