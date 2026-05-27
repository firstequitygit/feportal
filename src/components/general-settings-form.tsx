'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LogOut } from 'lucide-react'

interface SettingsInput {
  idle_timeout_hours: number
  absolute_session_hours: number
  maintenance_banner_enabled: boolean
  maintenance_banner_message: string
}

interface Props {
  initial: SettingsInput
}

export function GeneralSettingsForm({ initial }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<SettingsInput>(initial)
  const [saving, setSaving] = useState(false)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const dirty =
    values.idle_timeout_hours !== initial.idle_timeout_hours ||
    values.absolute_session_hours !== initial.absolute_session_hours ||
    values.maintenance_banner_enabled !== initial.maintenance_banner_enabled ||
    values.maintenance_banner_message !== initial.maintenance_banner_message

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty || saving) return

    if (values.maintenance_banner_enabled && !values.maintenance_banner_message.trim()) {
      toast.error('Maintenance message is required when the banner is enabled')
      return
    }

    setSaving(true)
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'Failed to save settings')
      return
    }
    toast.success('Settings saved')
    router.refresh()
  }

  async function handleForceLogout() {
    setLoggingOut(true)
    const res = await fetch('/api/admin/settings/force-logout', { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'Failed to force logout')
      setLoggingOut(false)
      return
    }
    window.location.href = '/login?reason=logged_out'
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <form onSubmit={handleSave} className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Session security</h3>

          <div>
            <label htmlFor="idle" className="block text-sm font-medium text-gray-700 mb-1">
              Idle timeout (hours)
            </label>
            <input
              id="idle"
              type="number"
              step="0.5"
              min="0.5"
              max="24"
              value={values.idle_timeout_hours}
              onChange={(e) => setValues(v => ({ ...v, idle_timeout_hours: Number(e.target.value) }))}
              className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">Logs users out after this many hours of no activity. 0.5 to 24, in 0.5h steps.</p>
          </div>

          <div>
            <label htmlFor="absolute" className="block text-sm font-medium text-gray-700 mb-1">
              Absolute session cap (hours)
            </label>
            <input
              id="absolute"
              type="number"
              step="1"
              min="1"
              max="168"
              value={values.absolute_session_hours}
              onChange={(e) => setValues(v => ({ ...v, absolute_session_hours: Number(e.target.value) }))}
              className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">Hard ceiling regardless of activity. 1 to 168 hours.</p>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Maintenance banner</h3>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={values.maintenance_banner_enabled}
              onChange={(e) => setValues(v => ({ ...v, maintenance_banner_enabled: e.target.checked }))}
              className="rounded border-gray-300"
            />
            Show banner to non-admin users
          </label>

          <div>
            <label htmlFor="banner-msg" className="block text-sm font-medium text-gray-700 mb-1">
              Banner message
            </label>
            <textarea
              id="banner-msg"
              rows={3}
              maxLength={500}
              value={values.maintenance_banner_message}
              onChange={(e) => setValues(v => ({ ...v, maintenance_banner_message: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Scheduled maintenance on Saturday 2pm-3pm ET..."
            />
            <p className="mt-1 text-xs text-gray-500">Plain text, up to 500 characters.</p>
          </div>
        </section>

        <button
          type="submit"
          disabled={!dirty || saving}
          className="bg-primary text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </form>

      <section className="border-t border-gray-200 pt-6 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Force log out all users</h3>
        <p className="text-sm text-gray-600">
          Invalidates every active session, including yours. Use this if you suspect an account is compromised or after rotating shared credentials.
        </p>

        {!confirmingLogout ? (
          <button
            type="button"
            onClick={() => setConfirmingLogout(true)}
            className="inline-flex items-center gap-2 border border-red-300 text-red-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Force log out all users
          </button>
        ) : (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 space-y-3">
            <p className="text-sm text-red-900 font-medium">
              This will log out every active user including you. You'll be redirected to the login page. Continue?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleForceLogout}
                disabled={loggingOut}
                className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loggingOut ? 'Logging out...' : 'Yes, log everyone out'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingLogout(false)}
                disabled={loggingOut}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
