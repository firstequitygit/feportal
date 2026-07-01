// The fixed PDF forms staff can send for e-signature from the
// E-Signature page. Each lives in public/esign-forms/ and gets an
// invisible BoldSign signature + date tag overlaid at (page, x, y)
// before sending (see overlay-tags.ts).
//
// x/y are PDF points from the page's bottom-left corner and are a
// first-pass placement — tune per form after a visual review of where
// the signature line actually sits. Changing a position here is the
// only edit needed; no other code depends on the coordinates.

export interface EsignForm {
  /** Stored on the envelope as document_kind. */
  key: string
  label: string
  /** Filename under public/esign-forms/. */
  file: string
  /** Page to place the signature block on: 'last' or a 1-based number. */
  page: 'last' | number
  /** Bottom-left of the signature tag, in points from the page bottom-left. */
  x: number
  y: number
}

export const ESIGN_FORMS: EsignForm[] = [
  { key: 'payoff_auth_fe',   label: 'Payoff Authorization (FE)',        file: 'payoff-authorization-fe.pdf',   page: 'last', x: 72, y: 150 },
  { key: 'payoff_auth_ev',   label: 'Payoff Authorization (EV)',        file: 'payoff-authorization-ev.pdf',   page: 'last', x: 72, y: 150 },
  { key: 'borrowers_auth',   label: "Borrower's Authorization",         file: 'borrowers-authorization.pdf',   page: 'last', x: 72, y: 150 },
  { key: 'credit_card_auth', label: 'Credit Card Authorization',        file: 'credit-card-authorization.pdf', page: 'last', x: 72, y: 150 },
  { key: 'vor_form',         label: 'Verification of Rent (VOR)',       file: 'vor-form.pdf',                  page: 1,      x: 72, y: 150 },
  { key: 'vom_form',         label: 'Verification of Mortgage (VOM)',   file: 'vom-form.pdf',                  page: 1,      x: 72, y: 150 },
  { key: 'ssa_89',           label: 'SSA-89 (Authorization for SSA)',   file: 'ssa-89.pdf',                    page: 1,      x: 72, y: 150 },
]

export function getEsignForm(key: string): EsignForm | undefined {
  return ESIGN_FORMS.find(f => f.key === key)
}

/** document_kind → human label, for naming the signed file the webhook
 *  files back on the loan. Includes the generated docs (term_sheet). */
export const ESIGN_DOC_LABELS: Record<string, string> = {
  term_sheet: 'Term Sheet',
  ...Object.fromEntries(ESIGN_FORMS.map(f => [f.key, f.label])),
}
