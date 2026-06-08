// Admin data tape — same pipeline view UW gets, useful for
// portfolio review and CSV exports from the admin side.
//
// SSR is intentionally tiny (auth check + shell). Table data is
// fetched client-side via /api/data-tape — see the UW page header
// comment for the full rationale.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { DataTapeClient } from '@/components/data-tape-client'
import { DATA_TAPE_MAX_ROWS } from '@/lib/fetch-data-tape'

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
          Excludes archived loans, New Application stage, and loans on hold.
        </p>
      </div>
      <DataTapeClient
        loanDetailHrefPrefix="/admin/loans"
        maxRows={DATA_TAPE_MAX_ROWS}
      />
    </PortalShell>
  )
}
