// Returns the staff recipients who should be notified when a borrower or
// broker takes action on a loan (uploads a document, responds to a
// condition). Per FE policy: the assigned primary loan processor
// (loan_processor_id, NOT the slot-2 LP) and the assigned loan officer.
// Returns the loan's property_address alongside so callers don't need to
// re-query for the email subject.

import { createAdminClient } from '@/lib/supabase/admin'

export interface StaffRecipients {
  property_address: string | null
  /** Distinct, deduplicated recipient emails (LP slot 1 + LO). */
  emails: string[]
  /** For per-recipient greetings if a caller wants them. */
  recipients: { email: string; name: string | null; role: 'loan_officer' | 'loan_processor' }[]
}

export async function getStaffRecipientsForLoan(loanId: string): Promise<StaffRecipients> {
  const adminClient = createAdminClient()
  const { data: loan } = await adminClient
    .from('loans')
    .select(`
      property_address,
      loan_officers ( full_name, email ),
      loan_processors!loan_processor_id ( full_name, email )
    `)
    .eq('id', loanId)
    .single()

  const recipients: StaffRecipients['recipients'] = []

  const lo = (loan?.loan_officers as unknown as { full_name: string | null; email: string | null } | null) ?? null
  if (lo?.email) recipients.push({ email: lo.email, name: lo.full_name, role: 'loan_officer' })

  const lp = (loan?.loan_processors as unknown as { full_name: string | null; email: string | null } | null) ?? null
  if (lp?.email) recipients.push({ email: lp.email, name: lp.full_name, role: 'loan_processor' })

  const seen = new Set<string>()
  const emails: string[] = []
  for (const r of recipients) {
    const k = r.email.toLowerCase()
    if (!seen.has(k)) { seen.add(k); emails.push(r.email) }
  }

  return {
    property_address: loan?.property_address ?? null,
    emails,
    recipients,
  }
}
