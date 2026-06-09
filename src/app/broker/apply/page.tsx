import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'
import { Wizard } from '@/app/apply/_components/wizard'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata = { title: 'Broker Application - First Equity Funding' }

async function fetchLoanOfficerOptions(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data } = await admin
    .from('loan_officers')
    .select('full_name')
    .order('full_name')
  const names = (data ?? [])
    .map((lo) => (lo.full_name as string | null) ?? '')
    .filter((n) => n.trim().length > 0)
  return [...names, 'Other']
}

export default async function BrokerApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const sp = await searchParams
  const impersonation = await resolveImpersonation(admin, user.id, sp)
  const isImpersonating = impersonation?.kind === 'broker'

  const { data: broker } = isImpersonating
    ? await admin.from('brokers').select('*').eq('id', impersonation.id).maybeSingle()
    : await admin.from('brokers').select('*').eq('auth_user_id', user.id).maybeSingle()
  if (!broker) redirect('/login')

  // Reuse an open draft if the broker has one; otherwise create a new one
  // seeded with their identity. The wizard hits PATCH for autosave from here.
  const { data: existing } = await admin
    .from('loan_applications')
    .select('id, resume_token, data, current_step')
    .eq('submitted_by_broker_id', broker.id)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let draft = existing
  if (!draft) {
    const seededPrimary: Record<string, unknown> = {
      brokerage_name: (broker.company_name as string | null) ?? '',
      broker_license_number: '',
      broker_license_state: '',
      broker_email: (broker.email as string | null) ?? '',
      broker_phone: (broker.phone as string | null) ?? '',
    }
    const { data: inserted, error } = await admin
      .from('loan_applications')
      .insert({
        status: 'draft',
        current_step: 1,
        application_kind: 'broker',
        submitted_by_broker_id: broker.id,
        resume_email: broker.email,
        data: { primary: seededPrimary },
      })
      .select('id, resume_token, data, current_step')
      .single()
    if (error || !inserted) redirect('/broker')
    draft = inserted
  }

  const loanOfficerOptions = await fetchLoanOfficerOptions(admin)

  return (
    <PortalShell
      userName={broker.full_name ?? broker.email}
      userRole="Broker"
      dashboardHref="/broker"
      variant="broker"
      impersonation={isImpersonating ? {
        kind: 'broker',
        name: broker.full_name,
        exitHref: impersonationExitHref(),
      } : null}
    >
      <Suspense>
        <Wizard
          initialData={(draft.data ?? {}) as Record<string, unknown>}
          initialStep={Math.max(1, Math.min(5, draft.current_step ?? 1))}
          initialToken={draft.resume_token as string}
          isAdmin={false}
          loanOfficerOptions={loanOfficerOptions}
          variantKind="broker"
        />
      </Suspense>
    </PortalShell>
  )
}
