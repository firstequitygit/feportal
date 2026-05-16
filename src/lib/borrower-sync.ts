// Shared borrower lookup / creation logic used by both sync routes
// (/api/cron/sync and /api/sync). Given the borrower info embedded on a
// Pipedrive deal, returns the portal borrower row id, creating or linking
// one as needed.
//
// Match priority:
//   1. existing borrowers row with the same pipedrive_person_id
//   2. existing borrowers row with the same email
//   3. insert a new borrowers row
//
// Never overwrites the email on a borrower that already has an auth_user_id
// — that's the address they sign in with, and a Pipedrive edit shouldn't
// silently break their login.

import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

export interface PipedrivePerson {
  pipedrive_person_id: number
  full_name: string | null
  email: string | null
  phone: string | null
}

export async function findOrLinkBorrower(
  supabase: SupabaseAdmin,
  person: PipedrivePerson,
): Promise<string | null> {
  // The borrowers table requires email NOT NULL — skip when Pipedrive has none.
  if (!person.email) return null

  // 1. Already linked by Pipedrive person id
  const byPersonId = await supabase
    .from('borrowers')
    .select('id, auth_user_id, email')
    .eq('pipedrive_person_id', person.pipedrive_person_id)
    .maybeSingle()
  if (byPersonId.data) {
    const updates: Record<string, unknown> = {
      full_name: person.full_name,
      phone: person.phone,
    }
    if (!byPersonId.data.auth_user_id && person.email !== byPersonId.data.email) {
      updates.email = person.email
    }
    await supabase.from('borrowers').update(updates).eq('id', byPersonId.data.id)
    return byPersonId.data.id
  }

  // 2. Existing borrower with same email but no Pipedrive link — attach
  const byEmail = await supabase
    .from('borrowers').select('id').eq('email', person.email).maybeSingle()
  if (byEmail.data) {
    await supabase
      .from('borrowers')
      .update({
        pipedrive_person_id: person.pipedrive_person_id,
        full_name: person.full_name,
        phone: person.phone,
      })
      .eq('id', byEmail.data.id)
    return byEmail.data.id
  }

  // 3. Create a new borrower
  const { data: created, error } = await supabase
    .from('borrowers')
    .insert({
      pipedrive_person_id: person.pipedrive_person_id,
      email: person.email,
      full_name: person.full_name,
      phone: person.phone,
    })
    .select('id')
    .single()
  if (error) {
    console.error('findOrLinkBorrower create error:', error.message, 'email:', person.email)
    return null
  }
  return created.id
}
