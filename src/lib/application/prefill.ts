// Builds the pre-filled ApplicationData for a returning borrower starting a new
// application. Keeps ONLY person-level fields (identity, contact, address,
// experience, demographics). Property/deal, declarations, and authorization
// signatures are intentionally dropped so the borrower adds the new property,
// re-confirms declarations, and re-signs every application.
//
// Whitelist (keep) approach, not blacklist (strip): anything not explicitly
// person-level is dropped, so new deal fields can never leak across applications.

import { createAdminClient } from '@/lib/supabase/admin'
import type { ApplicationData } from '@/lib/application-fields'
import { EXPERIENCE_FIELDS, HMDA_FIELDS } from '@/lib/application-fields'

// Root-level (un-prefixed) keys that are person-level and safe to carry over.
const KEEP_ROOT_KEYS: string[] = [
  ...EXPERIENCE_FIELDS.map((f) => f.name),
  ...HMDA_FIELDS.map((f) => f.name),
]

/** Reduce a full application payload to person-level fields only. */
export function stripToPersonal(data: ApplicationData): ApplicationData {
  const out: ApplicationData = {}
  const rec = data as Record<string, unknown>
  if (rec.primary && typeof rec.primary === 'object') out.primary = rec.primary
  if (Array.isArray(rec.co_borrowers)) out.co_borrowers = rec.co_borrowers
  for (const k of KEEP_ROOT_KEYS) {
    if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') out[k] = rec[k]
  }
  return out
}

/** Map a borrowers table row to a minimal person-level prefill (legacy fallback
 *  for borrowers who never used the new wizard, e.g. Airtable/Pipedrive imports). */
function borrowerRowToPrefill(b: Record<string, unknown>): ApplicationData {
  const fullName = (b.full_name as string | null) ?? ''
  const parts = fullName.trim().split(/\s+/)
  const first = parts.length > 0 ? parts[0] : ''
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  const primary: Record<string, unknown> = {
    first_name: first,
    last_name: last,
    email: b.email ?? '',
    cell_phone: b.phone ?? '',
    entity_name: b.entity_name ?? '',
    address_street: b.current_address_street ?? '',
    address_city: b.current_address_city ?? '',
    address_state: b.current_address_state ?? '',
    address_zip: b.current_address_zip ?? '',
    prior_address_street: b.prior_address_street ?? '',
    prior_address_city: b.prior_address_city ?? '',
    prior_address_state: b.prior_address_state ?? '',
    prior_address_zip: b.prior_address_zip ?? '',
  }
  // Drop empties so the wizard's required-field gating still flags blanks.
  const cleaned = Object.fromEntries(
    Object.entries(primary).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  )
  return { primary: cleaned }
}

/** Load a person-level prefill for a returning borrower by email. Prefers their
 *  most recent submitted application's saved data; falls back to the borrowers
 *  row for legacy borrowers. Returns {} if nothing is found. */
export async function loadBorrowerPrefill(email: string): Promise<ApplicationData> {
  const admin = createAdminClient()

  const { data: app } = await admin
    .from('loan_applications')
    .select('data, created_at')
    .ilike('resume_email', email)
    .eq('status', 'submitted')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (app?.data && typeof app.data === 'object') {
    return stripToPersonal(app.data as ApplicationData)
  }

  const { data: b } = await admin
    .from('borrowers')
    .select('full_name, email, phone, entity_name, current_address_street, current_address_city, current_address_state, current_address_zip, prior_address_street, prior_address_city, prior_address_state, prior_address_zip')
    .ilike('email', email)
    .maybeSingle()

  if (b) return borrowerRowToPrefill(b as Record<string, unknown>)
  return {}
}
