// Underwriter data tape — Alicyn's full-pipeline view in the portal.
//
// SSR here is intentionally tiny: just the auth check + shell. The
// table data lives in /api/data-tape and is fetched client-side via
// <DataTapeClient/> so SSR can never bust the function size /
// timeout caps when the loan set gets large.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { DataTapeClient } from '@/components/data-tape-client'
import { DATA_TAPE_MAX_ROWS } from '@/lib/fetch-data-tape'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

export const dynamic = 'force-dynamic'

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

  const impersonation = await resolveImpersonation(adminClient, user.id, sp)
  const isImpersonating = impersonation?.kind === 'underwriter'

  const uw = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
    adminClient, 'underwriter', user.id,
  )
  if (!uw) redirect('/login')

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
          Excludes archived loans, New Application stage, and loans on hold.
        </p>
      </div>
      <DataTapeClient
        loanDetailHrefPrefix="/underwriter/loans"
        maxRows={DATA_TAPE_MAX_ROWS}
      />
    </PortalShell>
  )
}
