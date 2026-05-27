import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppSettings } from '@/lib/app-settings'
import { GeneralSettingsForm } from '@/components/general-settings-form'

export default async function GeneralSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('admin_users')
    .select('is_super')
    .eq('auth_user_id', user.id)
    .single()
  if (!admin?.is_super) redirect('/admin')

  const settings = await getAppSettings()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">General</h1>
        <p className="text-sm text-gray-500 mt-1">Configure session security and operational announcements.</p>
      </div>
      <GeneralSettingsForm
        initial={{
          idle_timeout_hours: settings.idle_timeout_hours,
          absolute_session_hours: settings.absolute_session_hours,
          maintenance_banner_enabled: settings.maintenance_banner_enabled,
          maintenance_banner_message: settings.maintenance_banner_message,
        }}
      />
    </div>
  )
}
