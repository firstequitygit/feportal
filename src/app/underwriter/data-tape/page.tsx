// Underwriter data tape — Alicyn's full-pipeline view in the portal.
// Mirrors the columns from her Airtable share so she can do the same
// triage / portfolio review without leaving the portal.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { DataTape } from '@/components/data-tape'
import { fetchDataTape } from '@/lib/fetch-data-tape'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

export default async function UnderwriterDataTapePage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  // Admin "View as Underwriter" support — admin-only.
  const impersonation = await resolveImpersonation(adminClient, user.id, sp)
  const isImpersonating = impersonation?.kind === 'underwriter'

  const uw = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
    adminClient, 'underwriter', user.id,
  )
  if (!uw) redirect('/login')

  const rows = await fetchDataTape(adminClient)

  return (
    <PortalShell
      userName={uw.full_name}
      userRole="Underwriter"
      dashboardHref="/underwriter/inbox"
      variant="underwriter"
      impersonation={isImpersonating ? {
        kind: 'underwriter',
        name: uw.full_name,
        exitHref: impersonationExitHref(),
      } : null}
    >
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Data Tape</h2>
        <p className="text-sm text-gray-500 mt-1">
          Pipeline-wide loan view — same fields Alicyn tracks in Airtable.
          Excludes archived loans and New Application stage.
        </p>
      </div>
      <DataTape rows={rows} loanDetailHref={id => `/underwriter/loans/${id}`} />
    </PortalShell>
  )
}
