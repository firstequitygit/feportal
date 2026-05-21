// Strip internal-staff name mentions from a loan_events.description so
// borrowers and brokers don't see who specifically on our team did what.
// Staff still see the full description.
//
// loan_events.description is free-form text composed at insert time by
// ~36 different API routes. Names get embedded in two patterns:
//
//   (a) suffix: "<action> by <Name>"
//       e.g. "entity_name set to SRG Cay LLC by Adam Scovill"
//
//   (b) prefix: "<Role> <Name> <verb> ..."
//       e.g. "Loan processor Rebecca Desfosse added condition (Borrower): ..."
//
// We redact both patterns. Refactoring every insert site is heavier than
// it's worth — the data already carries enough structure for a regex pass.

// Roles whose names we hide from external viewers. Order matters: longer
// labels first so "Administrator" matches before "Admin".
const STAFF_ROLES = [
  'Loan officer',
  'Loan processor',
  'Underwriter',
  'Administrator',
  'Admin',
]

/**
 * Returns a redacted copy of the description suitable for borrower/broker
 * viewing. If neither pattern matches, the original text is returned.
 */
export function redactStaffNames(text: string): string {
  let result = text

  // (a) suffix " by <Name>" at end of string
  // Matches 1-4 capitalized words after "by", optional trailing period.
  result = result.replace(
    /\s+by\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}\.?\s*$/,
    '',
  )

  // (b) prefix "<Role> <Name>" at start of string
  for (const role of STAFF_ROLES) {
    const re = new RegExp(
      `^${escapeRegex(role)}\\s+[A-Z][\\w'.-]*(?:\\s+[A-Z][\\w'.-]*){0,3}\\s+`,
    )
    const m = result.match(re)
    if (m) {
      result = result.slice(m[0].length)
      // Capitalize the new first letter so the sentence still reads naturally
      // ("Added condition..." instead of "added condition...").
      if (result.length > 0) {
        result = result.charAt(0).toUpperCase() + result.slice(1)
      }
      break
    }
  }

  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
