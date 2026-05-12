import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminTemplatesManager } from '@/components/admin-templates-manager'
import { type ConditionTemplate } from '@/lib/types'

export default async function UnderwriterTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const { data: uw } = await adminClient
    .from('underwriters').select('id, full_name').eq('auth_user_id', user.id).single()
  if (!uw) redirect('/login')

  const { data: templates } = await adminClient
    .from('condition_templates')
    .select('*')
    .order('loan_type', { ascending: true, nullsFirst: true })
    .order('title')

  return (
    <PortalShell userName={uw.full_name} userRole="Underwriter" dashboardHref="/underwriter" variant="underwriter" maxWidth="max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Condition Templates</h2>
      <AdminTemplatesManager
        initialTemplates={(templates ?? []) as ConditionTemplate[]}
        apiPath="/api/templates"
      />
    </PortalShell>
  )
}
