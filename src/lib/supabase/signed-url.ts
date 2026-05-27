import type { createAdminClient } from '@/lib/supabase/admin'

/** Effectively non-expiring: ~10 years in seconds. The documents bucket stays
 *  private; the PDF masks sensitive data, so a long-lived signed link is
 *  acceptable (design decision 2026-05-22). */
export const TEN_YEARS_SECONDS = 315_360_000

/** Mint a signed download URL for an object in the private `documents` bucket.
 *  Returns null on failure (caller treats the link as unavailable). */
export async function getSignedDocumentUrl(
  admin: ReturnType<typeof createAdminClient>,
  filePath: string,
  ttlSeconds: number = TEN_YEARS_SECONDS,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from('documents')
    .createSignedUrl(filePath, ttlSeconds)
  if (error) {
    console.error('createSignedUrl failed:', error.message)
    return null
  }
  return data?.signedUrl ?? null
}
