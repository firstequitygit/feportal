import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Reads a portal-settings row from the portal_settings table.
 *
 * Returns null only when the row is missing (never-configured).
 * Returns "" when the admin has explicitly cleared the value.
 * Callers MUST distinguish null (fall back to env) from "" (admin chose "none").
 */
export async function getPortalSetting(key: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('portal_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error) {
    console.error(`getPortalSetting(${key}) failed:`, error)
    return null
  }
  return data?.value ?? null
}

/**
 * Upserts a portal-settings row. Stamps updated_by; updated_at is auto-bumped by trigger.
 * Caller is responsible for admin authorization; this helper does not check.
 */
export async function setPortalSetting(
  key: string,
  value: string,
  updatedBy: string,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('portal_settings')
    .upsert(
      { key, value, updated_by: updatedBy },
      { onConflict: 'key' },
    )
  if (error) {
    throw new Error(`setPortalSetting(${key}) failed: ${error.message}`)
  }
}
