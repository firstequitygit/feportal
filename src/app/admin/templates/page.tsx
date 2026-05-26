import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminTemplatesManager } from '@/components/admin-templates-manager'
import { type ConditionTemplate } from '@/lib/types'
import { resolveImpersonation } from '@/lib/impersonate'

export default async function AdminTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id, full_name, is_super').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const adminClient = createAdminClient()
  const { data: templates } = await adminClient
    .from('condition_templates')
    .select('*')
    .order('loan_type', { ascending: true, nullsFirst: true })
    .order('title')

  const impersonation = await resolveImpersonation(adminClient, user.id, undefined)
  const showViewAsTrigger = !impersonation

  return (
    <PortalShell userName={admin.full_name} userRole="Administrator" dashboardHref="/admin" variant="admin" isSuperAdmin={admin.is_super ?? false} maxWidth="max-w-3xl" showViewAsTrigger={showViewAsTrigger}>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Condition Templates</h2>
      <AdminTemplatesManager initialTemplates={(templates ?? []) as ConditionTemplate[]} />
    </PortalShell>
  )
}
