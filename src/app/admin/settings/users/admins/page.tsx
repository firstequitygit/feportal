import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminUsersManager, type AdminRow } from '@/components/admin-users-manager'

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Visible to every admin. Super-admins additionally get create/delete in
  // the manager component; regular admins see a read-only list.
  const { data: me } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!me) redirect('/dashboard')
  const isSuper = me.is_super ?? false

  const adminClient = createAdminClient()
  const { data: admins } = await adminClient
    .from('admin_users')
    .select('id, full_name, email, is_super, created_at')
    .order('created_at', { ascending: true })

  return (
    <>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Admin Users</h3>
      <p className="text-sm text-gray-500 mb-6">
        {isSuper
          ? 'New admins are created with a temporary password that you share manually. They can reset it via the "Forgot password" flow on the login page.'
          : 'Read-only list of portal admins. Only super-admins can add or remove admins.'}
      </p>
      <AdminUsersManager
        initialAdmins={(admins ?? []) as AdminRow[]}
        currentUserId={me.id}
        isSuper={isSuper}
      />
    </>
  )
}
