// Staff directory for the @mention autocomplete.
//
// Same staff data as fetchStaffDirectory in loan-staff.ts BUT also
// includes admin_users — admins like Adam Scovill should be taggable
// even though they don't show up in the existing condition "Other"
// assignment picker. The autocomplete needs every human, not just the
// ones who hold an assignable staff row.
//
// The resulting list is shaped for the autocomplete: each entry has a
// stable token (camelCase no-spaces version of the full name) plus the
// role kind + id we need to create a mention row.

import { createAdminClient } from '@/lib/supabase/admin'

export type MentionableUserKind = 'admin' | 'loan_officer' | 'loan_processor' | 'underwriter'

export interface MentionableUser {
  /** Role table the id points at. */
  kind: MentionableUserKind
  /** Primary key on that role table. */
  id: string
  /** Display name (e.g. "Adam Scovill"). */
  full_name: string
  /** Stable token used in @mention text (e.g. "AdamScovill"). */
  token: string
  /** Email for the notification. */
  email: string | null
}

/**
 * Builds a "@FirstLast" token from a full name. Strips whitespace and
 * non-alphanumerics so the autocomplete inserts a clean, regex-safe
 * marker into the text. Identical first names collide — we lean on the
 * dropdown UI to disambiguate by full name BEFORE selection, and the
 * backend trusts the mention id list sent alongside the text rather
 * than re-parsing the token.
 */
function tokenize(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '')
}

/**
 * FE convention: when a human has both an admin_users row AND a working-
 * role row, the admin row's full_name typically carries an "(Admin)"
 * suffix (e.g. "Adam Scovill (Admin)") to distinguish it inside the
 * admin tables. That's useful internally but should never surface in
 * the @mention dropdown — staff identify those people by their working
 * role name. Strip the suffix here for both display and dedup.
 */
function stripAdminSuffix(name: string): string {
  return name.replace(/\s*\(\s*admin\s*\)\s*$/i, '').trim()
}

export async function fetchMentionableStaff(): Promise<MentionableUser[]> {
  const adminClient = createAdminClient()

  const [
    { data: admins },
    { data: los },
    { data: lps },
    { data: uws },
  ] = await Promise.all([
    adminClient.from('admin_users').select('id, full_name, email').order('full_name'),
    adminClient.from('loan_officers').select('id, full_name, email').order('full_name'),
    adminClient.from('loan_processors').select('id, full_name, email').order('full_name'),
    adminClient.from('underwriters').select('id, full_name, email').order('full_name'),
  ])

  const out: MentionableUser[] = []
  function push(rows: { id: string; full_name: string | null; email: string | null }[] | null, kind: MentionableUserKind) {
    for (const r of rows ?? []) {
      // Strip the "(Admin)" suffix that admin_users carries so it never
      // shows in the dropdown and so dedup-by-name catches duplicates.
      const name = stripAdminSuffix((r.full_name ?? '').trim())
      if (!name) continue
      out.push({
        kind,
        id: r.id,
        full_name: name,
        token: tokenize(name),
        email: r.email ?? null,
      })
    }
  }
  // Push order matters for dedup below: the FIRST entry per name wins.
  // Non-admin roles come first so people who hold BOTH an admin row AND
  // a working-role row (Adam Scovill, Anthony Palmiotto, Omayra Cartagena
  // today) show up under their working role — that's how they're
  // identified in day-to-day work, and it also avoids "Name (Admin)"
  // dupes appearing in the autocomplete. Admin-only humans still show.
  push(los,    'loan_officer')
  push(lps,    'loan_processor')
  push(uws,    'underwriter')
  push(admins, 'admin')

  // Deduplicate by case-insensitive full name; first occurrence wins.
  const seen = new Set<string>()
  const dedup: MentionableUser[] = []
  for (const u of out) {
    const key = u.full_name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    dedup.push(u)
  }
  return dedup
}
