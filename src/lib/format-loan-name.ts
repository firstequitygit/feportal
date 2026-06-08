// Standard display name for a loan everywhere it's identified as a
// FILE / record (loan list cards, detail page headers, data tape,
// emails). Format:
//
//   "{Borrower full name} — {street portion of property_address}"
//   e.g. "David D'Agostino — 7 Earles Lane"
//
// The "street portion" is everything before the first comma in
// property_address. If the address has no comma we use it whole.
// Fallback chain:
//   borrower + street → "{borrower} — {street}"
//   borrower only     → borrower
//   street only       → street
//   raw address       → address as stored
//   loan number only  → "Loan {loanNumber}"
//   nothing           → "Unnamed loan"
//
// The property_address column itself is NOT renamed by this — when
// you're showing the literal property address (Loan Summary's
// "Property" field, the Pipedrive / Airtable sync, the approval
// letter's "RE:" line, etc.) keep using property_address directly.
// This helper is for the LOAN's name as a record/title.

export interface LoanNameSource {
  borrowerName?: string | null
  propertyAddress?: string | null
  /** Optional final fallback when both borrower + address are
   *  missing (e.g. a newly-synced Pipedrive deal). */
  loanNumber?: string | null
}

export function formatLoanName({
  borrowerName,
  propertyAddress,
  loanNumber,
}: LoanNameSource): string {
  const borrower = trimToNull(borrowerName)
  const street = streetFromAddress(propertyAddress)
  if (borrower && street) return `${borrower} — ${street}`
  if (borrower) return borrower
  if (street) return street
  const raw = trimToNull(propertyAddress)
  if (raw) return raw
  const num = trimToNull(loanNumber)
  if (num) return `Loan ${num}`
  return 'Unnamed loan'
}

/** Extracts the street portion of a property address — the substring
 *  before the first comma. Returns null when the address is empty.
 *  Examples:
 *    "7 Earles Lane, Newtown Square, PA 19073" → "7 Earles Lane"
 *    "86-27 130th Street, , NY 11418"          → "86-27 130th Street"
 *    "Just a street name"                       → "Just a street name"
 *    null / "" / "   "                          → null
 */
export function streetFromAddress(address: string | null | undefined): string | null {
  const trimmed = trimToNull(address)
  if (!trimmed) return null
  const i = trimmed.indexOf(',')
  if (i === -1) return trimmed
  const head = trimmed.slice(0, i).trim()
  return head || null
}

function trimToNull(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  return t || null
}
