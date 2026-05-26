import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminUnderwritersManager } from '@/components/admin-underwriters-manager'
import { type Underwriter } from '@/lib/types'

export default async function UnderwritersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users').select('id, is_super').eq('auth_user_id', user.id).single()
  if (!admin) redirect('/dashboard')

  const { data: underwriters } = await createAdminClient()
    .from('underwriters')
    .select('*')
    .order('full_name')

  return (
    <AdminUnderwritersManager initialUnderwriters={(underwriters ?? []) as Underwriter[]} />
  )
}
