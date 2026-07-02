// The fixed PDF forms staff can send for e-signature from the
// E-Signature page. Each lives in public/esign-forms/.
//
// Every placement below is in PDF points measured from the page's
// BOTTOM-LEFT corner (pdf-lib's native origin; fill-form.ts converts
// to BoldSign's top-origin bounds). Three kinds of placements:
//
//   fill         staff-typed values, stamped as black text onto the
//                PDF in the portal BEFORE sending (x/y = text baseline)
//   signerBoxes  input boxes the SIGNER completes in BoldSign at
//                signing time. Used for data staff should never
//                handle: card number/CVV, SSN, date of birth.
//   signature / dateSigned  the BoldSign signature field and the
//                auto-filled signing-date field
//
// stamps are constant marks always drawn (e.g. the SSA-89 "To apply
// for a mortgage" checkbox). Coordinates were measured from each
// PDF's text layer. The Preview button on the E-Signature page
// renders every placement visibly, so tuning is: edit here, preview.

export type EsignPrefill = 'borrower_name' | 'property_address' | 'loan_number'

export interface EsignFillField {
  key: string
  /** Input label shown to staff in the console. */
  label: string
  /** 1-based page number. */
  page: number
  /** Baseline of the first text line, points from bottom-left. */
  x: number
  y: number
  /** Loan field the console prefills the input with (staff-editable). */
  prefill?: EsignPrefill
  /** Static default the console seeds the input with (staff-editable). */
  defaultText?: string
  /** Max rendered width in points; text wraps or shrinks to fit. */
  maxWidth?: number
  /** Max wrapped lines (default 1). */
  maxLines?: number
  /** Distance between wrapped lines in points (default 13). */
  lineHeight?: number
  /** Render a textarea (multi-line address blocks). */
  multiline?: boolean
}

export interface EsignBox {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface EsignSignerBox extends EsignBox {
  type: 'textbox' | 'checkbox'
  /** Shown to staff in the console so they know what the borrower
   *  will be asked to complete at signing. */
  label: string
  required?: boolean
}

export interface EsignStamp {
  page: number
  x: number
  y: number
  text: string
  size?: number
}

export interface EsignForm {
  /** Stored on the envelope as document_kind. */
  key: string
  label: string
  /** Filename under public/esign-forms/. */
  file: string
  signature: EsignBox
  dateSigned: EsignBox
  fill: EsignFillField[]
  signerBoxes?: EsignSignerBox[]
  stamps?: EsignStamp[]
}

export const ESIGN_FORMS: EsignForm[] = [
  {
    key: 'payoff_auth_fe',
    label: 'Payoff Authorization (FE)',
    file: 'payoff-authorization-fe.pdf',
    // A4 page (595x842). Labels sit at x=99; values start after them.
    signature: { page: 1, x: 160, y: 213, width: 185, height: 35 },
    dateSigned: { page: 1, x: 95, y: 194, width: 90, height: 18 },
    fill: [
      { key: 'loan_id',          label: 'Loan ID',                        page: 1, x: 142, y: 638.6, prefill: 'loan_number',     maxWidth: 380 },
      { key: 'borrower_entity',  label: 'Borrower / Entity Name',         page: 1, x: 215, y: 623.5, prefill: 'borrower_name',   maxWidth: 310 },
      { key: 'property_address', label: 'Property Address',               page: 1, x: 186, y: 608.3, prefill: 'property_address', maxWidth: 340 },
      { key: 'gtd',              label: 'Payoff Good-through Date (GTD)', page: 1, x: 252, y: 592.0, maxWidth: 270 },
      { key: 'tp_name',          label: 'Third Party Name',               page: 1, x: 187, y: 497.7, maxWidth: 330 },
      { key: 'tp_contact',       label: 'Third Party Contact #',          page: 1, x: 203, y: 482.5, maxWidth: 310 },
      { key: 'tp_email',         label: 'Third Party Email Address',      page: 1, x: 222, y: 467.4, maxWidth: 300 },
    ],
  },
  {
    key: 'payoff_auth_ev',
    label: 'Payoff Authorization (EV)',
    file: 'payoff-authorization-ev.pdf',
    signature: { page: 1, x: 160, y: 213, width: 185, height: 35 },
    dateSigned: { page: 1, x: 95, y: 194, width: 90, height: 18 },
    fill: [
      { key: 'loan_id',          label: 'Loan ID',                        page: 1, x: 142, y: 638.6, prefill: 'loan_number',     maxWidth: 380 },
      { key: 'borrower_entity',  label: 'Borrower / Entity Name',         page: 1, x: 215, y: 623.5, prefill: 'borrower_name',   maxWidth: 310 },
      { key: 'property_address', label: 'Property Address',               page: 1, x: 186, y: 608.3, prefill: 'property_address', maxWidth: 340 },
      { key: 'ssn4',             label: 'Borrower SSN (last 4)',          page: 1, x: 266, y: 595.0, maxWidth: 40 },
      { key: 'co_ssn4',          label: 'Co-Borrower SSN (last 4)',       page: 1, x: 338, y: 580.0, maxWidth: 40 },
      { key: 'gtd',              label: 'Payoff Good-through Date (GTD)', page: 1, x: 252, y: 563.2, maxWidth: 270 },
      { key: 'tp_name',          label: 'Third Party Name',               page: 1, x: 187, y: 497.7, maxWidth: 330 },
      { key: 'tp_contact',       label: 'Third Party Contact #',          page: 1, x: 203, y: 482.5, maxWidth: 310 },
      { key: 'tp_email',         label: 'Third Party Email Address',      page: 1, x: 222, y: 467.4, maxWidth: 300 },
    ],
  },
  {
    key: 'borrowers_auth',
    label: "Borrower's Authorization",
    file: 'borrowers-authorization.pdf',
    // Printed name + date boxes are on page 1; the signature area is
    // the blank space under the "Signature" heading on page 2.
    signature: { page: 2, x: 54, y: 650, width: 220, height: 45 },
    dateSigned: { page: 1, x: 310, y: 171, width: 120, height: 18 },
    fill: [
      { key: 'printed_name', label: 'Borrower Printed Name', page: 1, x: 60, y: 174, prefill: 'borrower_name', maxWidth: 235 },
    ],
  },
  {
    key: 'credit_card_auth',
    label: 'Credit Card Authorization',
    file: 'credit-card-authorization.pdf',
    signature: { page: 1, x: 58, y: 276, width: 190, height: 34 },
    dateSigned: { page: 1, x: 274, y: 277, width: 110, height: 20 },
    fill: [
      { key: 'auth_name', label: 'Printed name ("I, ___, authorize")', page: 1, x: 68, y: 359, prefill: 'borrower_name', maxWidth: 148 },
      { key: 'amount',    label: 'Amount to charge ($)',               page: 1, x: 442, y: 421, maxWidth: 100 },
    ],
    // All card details are completed by the cardholder at signing so
    // card numbers never pass through staff or the portal.
    signerBoxes: [
      { type: 'checkbox', label: 'Card type: MasterCard', page: 1, x: 125.5, y: 520.5, width: 12, height: 12 },
      { type: 'checkbox', label: 'Card type: VISA',       page: 1, x: 233.5, y: 520.5, width: 12, height: 12 },
      { type: 'checkbox', label: 'Card type: Discover',   page: 1, x: 341.5, y: 520.5, width: 12, height: 12 },
      { type: 'checkbox', label: 'Card type: AMEX',       page: 1, x: 449.5, y: 520.5, width: 12, height: 12 },
      { type: 'checkbox', label: 'Card type: Other',      page: 1, x: 125.5, y: 498.5, width: 12, height: 12 },
      { type: 'textbox',  label: 'Other card type',       page: 1, x: 170, y: 497,   width: 190, height: 16 },
      { type: 'textbox',  label: 'Cardholder Name',       page: 1, x: 216, y: 470,   width: 222, height: 17, required: true },
      { type: 'textbox',  label: 'Card Number',           page: 1, x: 128, y: 443.5, width: 190, height: 17, required: true },
      { type: 'textbox',  label: 'CVV Number',            page: 1, x: 452, y: 443.5, width: 100, height: 17, required: true },
      { type: 'textbox',  label: 'Expiration Date (mm/yy)', page: 1, x: 186, y: 417.5, width: 190, height: 17, required: true },
      { type: 'textbox',  label: 'Billing ZIP Code',      page: 1, x: 312, y: 390.5, width: 202, height: 17, required: true },
    ],
  },
  {
    key: 'vor_form',
    label: 'Verification of Rent (VOR)',
    file: 'vor-form.pdf',
    // Signature goes on the first "X" line of item 9 (X at 342, 382.8);
    // the date sits on the same line to its right.
    signature: { page: 1, x: 352, y: 381, width: 150, height: 34 },
    dateSigned: { page: 1, x: 506, y: 382, width: 64, height: 20 },
    fill: [
      { key: 'landlord',         label: 'To: Landlord name and address (item 1)', page: 1, x: 52, y: 600, maxWidth: 240, maxLines: 4, lineHeight: 14, multiline: true },
      { key: 'property_address', label: 'Property Address (item 7)',              page: 1, x: 52, y: 470, prefill: 'property_address', maxWidth: 240, maxLines: 2 },
      { key: 'account_name',     label: 'Account in the name of',                 page: 1, x: 308, y: 472, prefill: 'borrower_name', maxWidth: 272 },
      { key: 'applicant',        label: 'Name and address of applicant(s) (item 8)', page: 1, x: 52, y: 385, prefill: 'borrower_name', maxWidth: 240, maxLines: 3, lineHeight: 13.5, multiline: true },
    ],
  },
  {
    key: 'vom_form',
    label: 'Verification of Mortgage (VOM)',
    file: 'vom-form.pdf',
    // Signature goes on the first "X" line of item 9 (X at 342, 400.7);
    // the date sits on the same line to its right.
    signature: { page: 1, x: 352, y: 399, width: 150, height: 34 },
    dateSigned: { page: 1, x: 506, y: 400, width: 64, height: 20 },
    fill: [
      { key: 'creditor',         label: 'To: Creditor name and address (item 1)', page: 1, x: 52, y: 600, maxWidth: 240, maxLines: 4, lineHeight: 14, multiline: true },
      { key: 'property_address', label: 'Property Address (item 7)',              page: 1, x: 52, y: 476, prefill: 'property_address', maxWidth: 240, maxLines: 2 },
      { key: 'account_name',     label: 'Account in the name of',                 page: 1, x: 308, y: 478, prefill: 'borrower_name', maxWidth: 272 },
      { key: 'account_number',   label: "Loan number (borrower's account at creditor)", page: 1, x: 308, y: 455, maxWidth: 272 },
      { key: 'applicant',        label: 'Name and address of applicant(s) (item 8)', page: 1, x: 52, y: 405, prefill: 'borrower_name', maxWidth: 240, maxLines: 3, lineHeight: 13.5, multiline: true },
    ],
  },
  {
    key: 'ssa_89',
    label: 'SSA-89 (Authorization for SSA)',
    file: 'ssa-89.pdf',
    signature: { page: 1, x: 72, y: 329.5, width: 170, height: 32 },
    dateSigned: { page: 1, x: 484, y: 330, width: 100, height: 20 },
    // Company (First Equity) and Agent (PitchPoint) name/address were
    // already filled into the form's own AcroForm fields; those values
    // are flattened into the page, so only the borrower name is typed.
    fill: [
      { key: 'printed_name', label: 'Printed Name', page: 1, x: 90, y: 694, prefill: 'borrower_name', maxWidth: 190 },
    ],
    // SSN and date of birth are entered by the borrower at signing so
    // they never pass through staff email or the portal.
    // "To apply for a mortgage" is already checked in the flattened
    // form, so no stamp is needed.
    signerBoxes: [
      { type: 'textbox', label: 'Date of Birth',          page: 1, x: 352, y: 689, width: 58, height: 16, required: true },
      { type: 'textbox', label: 'Social Security Number', page: 1, x: 526, y: 689, width: 64, height: 16, required: true },
    ],
  },
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
