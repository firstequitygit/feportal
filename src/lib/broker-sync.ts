// Find-or-link broker from a Pipedrive Person. Mirrors borrower-sync —
// the Pipedrive deal has a custom "Broker" person field that points to a
// Pipedrive Person record; we resolve that to a portal brokers row,
// creating one if needed.
//
// Match priority:
//   1. existing brokers row with the same pipedrive_person_id
//   2. existing brokers row with the same email
//   3. insert a new brokers row
//
// Never overwrites the email on a broker that already has an auth_user_id
// — that's the address they sign in with, so a Pipedrive edit shouldn't
// silently break their login.

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchPerson } from '@/lib/pipedrive'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * Resolve the broker Pipedrive person id on a deal to a portal brokers row.
 * Returns the broker id (uuid) or null when:
 *   - personId is null (no broker on the deal)
 *   - Pipedrive returns no Person for that id
 *   - the Person has no email (the brokers table requires email NOT NULL)
 */
export async function findOrLinkBroker(
  supabase: SupabaseAdmin,
  personId: number | null,
): Promise<string | null> {
  if (!personId) return null

  // 1. Already linked by Pipedrive person id — fast path, no Pipedrive call
  const byPersonId = await supabase
    .from('brokers')
    .select('id, auth_user_id, email')
    .eq('pipedrive_person_id', personId)
    .maybeSingle()
  if (byPersonId.data) {
    // Optional refresh of name/phone (cheap, brokers table is small).
    const person = await fetchPerson(personId)
    if (person) {
      const updates: Record<string, unknown> = {
        full_name: person.name,
        phone: person.phone,
      }
      // Only update email if the broker hasn't claimed a login yet AND the
      // Pipedrive value actually differs — avoids breaking an existing
      // auth.users link the broker has been using to sign in.
      if (!byPersonId.data.auth_user_id && person.email && person.email !== byPersonId.data.email) {
        updates.email = person.email
      }
      await supabase.from('brokers').update(updates).eq('id', byPersonId.data.id)
    }
    return byPersonId.data.id
  }

  // Need the Pipedrive person details for the remaining branches.
  const person = await fetchPerson(personId)
  if (!person?.email) return null  // brokers.email is NOT NULL

  // 2. Existing broker with same email but no Pipedrive link — attach
  const byEmail = await supabase
    .from('brokers').select('id').eq('email', person.email).maybeSingle()
  if (byEmail.data) {
    await supabase
      .from('brokers')
      .update({
        pipedrive_person_id: personId,
        full_name: person.name,
        phone: person.phone,
      })
      .eq('id', byEmail.data.id)
    return byEmail.data.id
  }

  // 3. Create a new broker
  const { data: created, error } = await supabase
    .from('brokers')
    .insert({
      pipedrive_person_id: personId,
      email: person.email,
      full_name: person.name,
      phone: person.phone,
    })
    .select('id')
    .single()
  if (error) {
    console.error('findOrLinkBroker create error:', error.message, 'email:', person.email)
    return null
  }
  return created.id
}
