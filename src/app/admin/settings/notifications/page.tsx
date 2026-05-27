import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSetting } from '@/lib/portal-settings'
import { Card } from '@/components/ui/card'
import { NotificationsForm } from './notifications-form'

const KEY = 'applications_processing_inbox'

export default async function NotificationsSettingsPage() {
  // Admin gate is enforced by the parent layout (src/app/admin/settings/layout.tsx).
  // No additional gate needed here.

  const value = await getPortalSetting(KEY)

  const supabase = createAdminClient()
  const { data: row } = await supabase
    .from('portal_settings')
    .select('updated_at, updated_by')
    .eq('key', KEY)
    .maybeSingle()

  let updatedByName: string | null = null
  if (row?.updated_by) {
    const { data: editor } = await supabase
      .from('admin_users')
      .select('full_name')
      .eq('auth_user_id', row.updated_by)
      .maybeSingle()
    updatedByName = editor?.full_name ?? null
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Application Inbox</h3>
        <p className="mt-1 text-sm text-gray-600">
          When a borrower submits a loan application, an internal notice is sent to the assigned
          loan officer and to this central inbox.
        </p>
      </div>

      <Card className="p-6">
        <NotificationsForm
          initialValue={value ?? ''}
          initialUpdatedAt={row?.updated_at ?? null}
          initialUpdatedByName={updatedByName}
        />
      </Card>
    </div>
  )
}
