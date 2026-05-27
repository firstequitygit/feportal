import { createAdminClient } from '@/lib/supabase/admin'

export type AppSettings = {
  idle_timeout_hours: number
  absolute_session_hours: number
  session_epoch: number
  maintenance_banner_enabled: boolean
  maintenance_banner_message: string
  updated_at: string
  updated_by: string | null
}

const DEFAULTS: AppSettings = {
  idle_timeout_hours: 2,
  absolute_session_hours: 12,
  session_epoch: 0,
  maintenance_banner_enabled: false,
  maintenance_banner_message: '',
  updated_at: new Date(0).toISOString(),
  updated_by: null,
}

const TTL_MS = 30_000

let cache: { value: AppSettings; expiresAt: number } | null = null

export async function getAppSettings(): Promise<AppSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single()

  // If the row is missing or unreadable, fall back to defaults so the app
  // never wedges on a settings outage. The defaults match the migration.
  const value: AppSettings = error || !data ? DEFAULTS : (data as AppSettings)
  cache = { value, expiresAt: Date.now() + TTL_MS }
  return value
}

export function invalidateAppSettingsCache(): void {
  cache = null
}
