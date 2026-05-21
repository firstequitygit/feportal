// Sanity check for src/lib/redact-activity.ts logic against real samples.
const STAFF_ROLES = ['Loan officer','Loan processor','Underwriter','Administrator','Admin']
function escapeRegex(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function redact(text) {
  let r = text
  r = r.replace(/\s+by\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}\.?\s*$/, '')
  for (const role of STAFF_ROLES) {
    const re = new RegExp('^' + escapeRegex(role) + '\\s+[A-Z][\\w\'.-]*(?:\\s+[A-Z][\\w\'.-]*){0,3}\\s+')
    const m = r.match(re)
    if (m) { r = r.slice(m[0].length); r = r.charAt(0).toUpperCase() + r.slice(1); break }
  }
  return r
}
const samples = [
  'entity_name set to SRG Cay LLC by Adam Scovill',
  'Estimated closing date set to 2026-06-10 by Adam Scovill',
  'Loan processor Rebecca Desfosse added condition (Borrower): "Title Agent Contact Information"',
  'Loan officer Adam Scovill marked "Lease" as Received',
  'Loan officer Adam Scovill uploaded document for "Lease": Lease - 2341 Audubon.pdf',
  'Loan processor Rebecca Desfosse self-assigned to this loan',
  'Broker Rhonda Deriberprey assigned to this loan',
  '"Purchase Contract" marked Satisfied',
  'Condition added (Borrower): "Purchase Contract"',
]
for (const s of samples) {
  console.log('IN : ' + s)
  console.log('OUT: ' + redact(s))
  console.log()
}
