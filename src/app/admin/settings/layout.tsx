import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCookieImpersonationForShell } from '@/lib/impersonate'
import { PortalShell } from '@/components/portal-shell'
import { SettingsSidebar } from '@/components/settings-sidebar'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users')
    .select('id, full_name, is_super')
    .eq('auth_user_id', user.id)
    .single()
  if (!admin) redirect('/dashboard')

  const impersonation = await getCookieImpersonationForShell(createAdminClient(), user.id)

  return (
    <PortalShell
      userName={admin.full_name}
      userRole="Administrator"
      dashboardHref="/admin"
      variant="admin"
      isSuperAdmin={admin.is_super ?? false}
      impersonation={impersonation}
      maxWidth="max-w-7xl"
    >
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
      </div>
      <div className="flex gap-6">
        <SettingsSidebar isSuperAdmin={admin.is_super ?? false} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </PortalShell>
  )
}
