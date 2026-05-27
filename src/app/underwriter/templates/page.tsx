import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminTemplatesManager } from '@/components/admin-templates-manager'
import { type ConditionTemplate } from '@/lib/types'
import { getEffectiveRoleRow, resolveImpersonation, impersonationExitHref } from '@/lib/impersonate'

export default async function UnderwriterTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const uw = await getEffectiveRoleRow<{ id: string; full_name: string | null; email: string | null }>(
    adminClient, 'underwriter', user.id
  )
  if (!uw) redirect('/login')

  const { data: templates } = await adminClient
    .from('condition_templates')
    .select('*')
    .order('loan_type', { ascending: true, nullsFirst: true })
    .order('title')

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const isImpersonating = impersonation?.kind === 'underwriter'

  return (
    <PortalShell userName={uw.full_name} userRole="Underwriter" dashboardHref="/underwriter" variant="underwriter" maxWidth="max-w-3xl" impersonation={isImpersonating ? {
        kind: 'underwriter',
        name: uw.full_name,
        exitHref: impersonationExitHref(),
      } : null}>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Condition Templates</h2>
      <AdminTemplatesManager
        initialTemplates={(templates ?? []) as ConditionTemplate[]}
        apiPath="/api/templates"
      />
    </PortalShell>
  )
}
