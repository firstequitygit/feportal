import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminUsersManager, type AdminRow } from '@/components/admin-users-manager'

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Super-admins only. Regular admins land back on /admin.
  const { data: me } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!me) redirect('/dashboard')
  if (!me.is_super) redirect('/admin')

  const adminClient = createAdminClient()
  const { data: admins } = await adminClient
    .from('admin_users')
    .select('id, full_name, email, is_super, created_at')
    .order('created_at', { ascending: true })

  return (
    <PortalShell userName={null} userRole="Administrator" dashboardHref="/admin" variant="admin" isSuperAdmin={me.is_super ?? false} maxWidth="max-w-7xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Admin Users</h2>
      <p className="text-sm text-gray-500 mb-6">
        Only super-admins can see this page. New admins are created with a temporary password
        that you share manually. They can reset it via the &quot;Forgot password&quot; flow on the login page.
      </p>
      <AdminUsersManager
        initialAdmins={(admins ?? []) as AdminRow[]}
        currentUserId={me.id}
      />
    </PortalShell>
  )
}
