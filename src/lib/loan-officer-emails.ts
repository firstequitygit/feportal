// Interim loan-officer email routing. The application stores only the LO's
// display name (data.primary.loan_officer_assigned). There is no name->email
// link yet; the planned replacement drives this from active LO portal users.
// When that lands, replace ONLY the body of resolveLoanOfficerEmail - callers
// and the signature stay the same.

// TODO(user): fill in the real addresses. "Other" intentionally has no email.
export const LOAN_OFFICER_EMAILS: Record<string, string> = {
  'Christian Pepe': '',
  'Anthony Palmiotto': 'apalmiotto@outlook.com',
  'Cory J Anderson': '',
  'Ryan Commesso': '',
  'Bill McGrorry': '',
  'Vincent Gruosso': '',
  'Adam Scovill': '',
  'Garry Merritt': '',
  'Christopher Marcigliano': '',
}

/** Resolve the assigned loan officer's email, or null when unknown/"Other"/unmapped. */
export function resolveLoanOfficerEmail(name: string | null | undefined): string | null {
  if (!name) return null
  const email = LOAN_OFFICER_EMAILS[name.trim()]
  return email && email.includes('@') ? email : null
}
