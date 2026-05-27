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
  // numeric(3,1) is serialized as a string by PostgREST; coerce numeric columns.
  let value: AppSettings
  if (error || !data) {
    value = DEFAULTS
  } else {
    const row = data as Record<string, unknown>
    value = {
      idle_timeout_hours: Number(row.idle_timeout_hours),
      absolute_session_hours: Number(row.absolute_session_hours),
      session_epoch: Number(row.session_epoch),
      maintenance_banner_enabled: Boolean(row.maintenance_banner_enabled),
      maintenance_banner_message: String(row.maintenance_banner_message ?? ''),
      updated_at: String(row.updated_at ?? new Date(0).toISOString()),
      updated_by: (row.updated_by as string | null) ?? null,
    }
  }
  cache = { value, expiresAt: Date.now() + TTL_MS }
  return value
}

export function invalidateAppSettingsCache(): void {
  cache = null
}
