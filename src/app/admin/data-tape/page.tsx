// Admin data tape — same wide pipeline view UW gets, useful for
// portfolio review and CSV exports from the admin side.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { DataTape } from '@/components/data-tape'
import { fetchDataTape, DATA_TAPE_MAX_ROWS } from '@/lib/fetch-data-tape'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

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

  const result = await fetchDataTape(adminClient)

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
        {result.errorMessage && (
          <div className="mt-3 text-sm rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2">
            Could not load loans: {result.errorMessage}
          </div>
        )}
        {result.capped && !result.errorMessage && (
          <div className="mt-3 text-sm rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
            Showing the {DATA_TAPE_MAX_ROWS} most recently created loans of{' '}
            <strong>{result.totalMatching}</strong> matching loans. Use the
            search and filters below to narrow further; the CSV export
            covers everything currently visible.
          </div>
        )}
      </div>
      <DataTape rows={result.rows} loanDetailHref={id => `/admin/loans/${id}`} />
    </PortalShell>
  )
}
