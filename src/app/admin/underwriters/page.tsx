import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PortalShell } from '@/components/portal-shell'
import { AdminUnderwritersManager } from '@/components/admin-underwriters-manager'
import { type Underwriter } from '@/lib/types'

export default async function UnderwritersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const { data: underwriters } = await createAdminClient()
    .from('underwriters')
    .select('*')
    .order('full_name')

  return (
    <PortalShell userName={null} userRole="Administrator" dashboardHref="/admin" variant="admin" maxWidth="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Underwriters</h2>
      <AdminUnderwritersManager initialUnderwriters={(underwriters ?? []) as Underwriter[]} />
    </PortalShell>
  )
}
