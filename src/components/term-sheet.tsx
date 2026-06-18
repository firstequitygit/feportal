'use client'

// Loan Term Sheet — a multi-page legal document (~5-6 pages). Pages 1-3
// are boilerplate prose with a few inline merge fields (LLC NAME,
// BORROWER NAME, BORROWER ADDRESS). Appendix A is the appendix table
// of loan terms, which differs between DSCR and Fix&Flip / New
// Construction. Pages after the appendix are more boilerplate
// (FEES / TITLE INSURANCE / etc.).
//
// Printable HTML — UW prints to PDF via the browser print dialog,
// same pattern as the Conditional Approval Letter and the Committee
// Review Sheet.

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Download, PenLine } from 'lucide-react'
import {
  fmtCurrencyCents,
  fmtLetterDate,
  fmtExpirationDate,
  fmtRatePct,
  calcOriginationFee,
  calcBrokerFee,
  calcMonthlyPayment,
  loanProgramLabel,
  termLabel,
  joinGuarantors,
  composePropertyAddress,
} from '@/lib/loan-doc-format'

interface TermSheetLoan {
  loan_type: string | null
  loan_amount: number | null
  interest_rate: number | null
  term_months: number | null
  interest_only: string | null
  arv: number | null
  rehab_budget: number | null
  entity_name: string | null
  property_address: string | null
}

interface TermSheetDetails {
  rate_type: string | null
  amortization_schedule: string | null
  prepayment_penalty: string | null
  points: number | null
  broker_points: number | null
  underwriting_fee: number | null
  legal_doc_prep_fee: number | null
  desk_review_fee: number | null
  small_balance_fee: number | null
  feasibility_fee: number | null
  construction_holdback: number | null
  draw_fee: number | null
  initial_loan_amount: number | null
  purchase_price: number | null
  property_street: string | null
  property_city: string | null
  property_state: string | null
  property_zip: string | null
  additional_fees: number | null
  additional_fees_notes: string | null
}

interface TermSheetBorrower {
  full_name: string | null
  current_address_street: string | null
  current_address_city: string | null
  current_address_state: string | null
  current_address_zip: string | null
}

interface EsignState {
  /** BOLDSIGN_API_KEY configured server-side. */
  enabled: boolean
  /** Latest envelope status for this loan's term sheet, if any. */
  status: string | null
  /** Primary borrower has an email on file (required to send). */
  signerHasEmail: boolean
}

interface Props {
  loanId: string
  loan: TermSheetLoan
  details: TermSheetDetails
  borrower: TermSheetBorrower | null
  coBorrowerNames: string[]
  backHref: string
  esign?: EsignState
  /** Whether to show the First Equity logo. Hidden on broker-assigned
   *  loans — those term sheets go out under the broker, not FE branding. */
  showLogo?: boolean
}

const ESIGN_STATUS_LABELS: Record<string, { label: string; classes: string }> = {
  sent:      { label: 'Out for signature', classes: 'bg-blue-100 text-blue-700 border-blue-200' },
  viewed:    { label: 'Viewed by signer',  classes: 'bg-blue-100 text-blue-700 border-blue-200' },
  signed:    { label: 'Signed',            classes: 'bg-green-100 text-green-700 border-green-200' },
  completed: { label: 'Signed ✓',          classes: 'bg-green-100 text-green-700 border-green-200' },
  declined:  { label: 'Declined',          classes: 'bg-red-100 text-red-700 border-red-200' },
  revoked:   { label: 'Revoked',           classes: 'bg-gray-100 text-gray-600 border-gray-200' },
  expired:   { label: 'Expired',           classes: 'bg-gray-100 text-gray-600 border-gray-200' },
}

export function TermSheet({ loanId, loan, details, borrower, coBorrowerNames, backHref, esign, showLogo = true }: Props) {
  const [sending, setSending] = useState(false)

  async function sendForSignature() {
    if (sending) return
    if (!confirm('Send the Term Sheet to the borrower for e-signature?')) return
    setSending(true)
    try {
      const res = await fetch(`/api/esign/term-sheet/${loanId}/send`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error ?? 'Failed to send for signature.')
        return
      }
      window.location.reload()
    } finally {
      setSending(false)
    }
  }
  const [letterDate, setLetterDate] = useState<string>(fmtLetterDate())

  const isFixFlip = loan.loan_type === 'Fix & Flip (Bridge)' || loan.loan_type === 'New Construction'
  const llcName = loan.entity_name ?? '—'
  const borrowerName = borrower?.full_name ?? '—'
  const borrowerAddress =
    composePropertyAddress(
      borrower?.current_address_street,
      borrower?.current_address_city,
      borrower?.current_address_state,
      borrower?.current_address_zip,
      '—',
    )
  const guarantors = joinGuarantors(borrower?.full_name, ...coBorrowerNames)
  const collateral = composePropertyAddress(
    details.property_street,
    details.property_city,
    details.property_state,
    details.property_zip,
    loan.property_address ?? '—',
  )

  // Calculations
  const originationFee = calcOriginationFee(loan.loan_amount, details.points)
  const brokerFee = calcBrokerFee(loan.loan_amount, details.broker_points)
  const monthly = calcMonthlyPayment(
    loan.loan_amount,
    loan.interest_rate,
    loan.term_months,
    loan.interest_only,
    details.amortization_schedule,
  )

  return (
    <>
      <PrintStyles />

      {/* Toolbar — hidden on print */}
      <div className="no-print bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href={backHref} className="flex items-center gap-1.5 text-sm text-primary hover:opacity-80">
            <ArrowLeft className="w-4 h-4" />
            Back to Loan
          </Link>
          <div className="flex items-center gap-2">
            {/* E-sign status pill + send button — only when the
                BoldSign integration is configured server-side. */}
            {esign?.enabled && esign.status && ESIGN_STATUS_LABELS[esign.status] && (
              <span className={`text-xs px-2 py-1 rounded-full border ${ESIGN_STATUS_LABELS[esign.status].classes}`}>
                {ESIGN_STATUS_LABELS[esign.status].label}
              </span>
            )}
            {esign?.enabled && !['sent', 'viewed', 'signed', 'completed'].includes(esign.status ?? '') && (
              <button
                onClick={sendForSignature}
                disabled={sending || !esign.signerHasEmail}
                title={esign.signerHasEmail ? 'Send to the borrower for e-signature' : 'Primary borrower needs an email on file first'}
                className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PenLine className="w-4 h-4" />
                {sending ? 'Sending…' : 'Send for Signature'}
              </button>
            )}
            {/* Server-rendered PDF download. Goes through
                /api/term-sheet/[id]/pdf so font rendering stays
                clean (browser print was mangling lowercase "l"s in
                Chrome's export). The on-screen view below acts as
                the preview. */}
            <a
              href={`/api/term-sheet/${loanId}/pdf`}
              className="flex items-center gap-2 bg-primary text-white text-sm font-medium px-4 py-2 rounded-md hover:opacity-90"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </a>
          </div>
        </div>
      </div>

      <div className="bg-gray-100 min-h-screen py-8 print:py-0 print:bg-white">
        <div
          // Tighter type + padding than the Approval Letter — the
          // Term Sheet has a lot of legal prose and each page needs
          // to fit cleanly between the @page margins. text-[12px] +
          // leading-snug is the densest we can go before readability
          // suffers on the printed PDF.
          className="letter-page max-w-4xl mx-auto bg-white shadow-md print:shadow-none px-10 py-6 text-gray-900 text-[12px] leading-snug"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {/* ---- Page 1 — Cover ---- */}
          <PageBlock>
            <LogoBar show={showLogo} />

            <h1 className="text-sm font-bold text-center mt-4">LOAN TERM SHEET</h1>
            <div className="text-center mt-1">
              <input
                type="text"
                value={letterDate}
                onChange={e => setLetterDate(e.target.value)}
                className="editable-text text-[12px] w-32 text-center"
                aria-label="Letter date"
              />
            </div>

            <div className="mt-5 space-y-0.5">
              <p>{llcName}</p>
              <p>{borrowerName}</p>
              <p>{borrowerAddress}</p>
            </div>

            <p className="mt-4">Dear {borrowerName},</p>

            <p className="mt-3">
              First Equity Capital, LLC (&ldquo;First Equity&rdquo;) is pleased to present to you the
              following loan proposal. The costs outlined herein are estimates. The creation of a
              legally binding commitment or obligation is subject to the delivery of documents
              requested by First Equity, final approval of the Borrower&rsquo;s request for a loan and
              the execution and delivery of an agreement by both Borrower and First Equity to the
              transactions contemplated hereby, and the consummation of such transactions will be
              subject to the satisfaction of the conditions set forth therein.
            </p>

            <p className="mt-2">
              This Loan Term Sheet Letter (&ldquo;Letter&rdquo;) outlines the proposed transaction between
              First Equity a New Jersey limited liability company (&ldquo;Lender&rdquo;), and, {llcName},
              (&ldquo;Borrower&rdquo;), pursuant to which Lender would lend funds to Borrower (the
              &ldquo;Proposed Transaction&rdquo;). This Letter supersedes any prior letters or
              discussions regarding the Proposed Transaction.
            </p>

            <NumberedClause num={1} title="Limited Binding Effect.">
              <p>
                (a) Except as provided in subsections (b) and (c) below, this Letter does not create,
                and is not intended to create, an offer capable of acceptance, or acceptance of any
                offer previously made, nor create or memorialize any binding legal or contractual
                obligations on the part of either party, but is intended merely to provide a basis upon
                which the parties can continue to consider this matter, execute and deliver a definitive
                agreement, including a note, mortgage and other necessary loan documents (collectively,
                the &ldquo;Loan Documents&rdquo;).
              </p>
              <p className="mt-1.5">
                (b) Notwithstanding the foregoing subsection (a), Sections 3, 4, 5, 6 and 7 of this
                Letter are intended to create binding legal and contractual obligations of the parties
                with respect to matters set forth therein, and upon the breach by a party of its
                obligations under any of Sections 3, 4, 5, 6 and 7 in any respect, the injured party
                shall have such rights and remedies with respect thereto as are available to it under
                applicable law.
              </p>
              <p className="mt-1.5">
                (c) Upon execution and delivery of the Loan Documents, this Letter shall be superseded
                thereby and the rights and obligations of the parties with respect to the Proposed
                Transaction shall thereafter be governed by the Loan Documents.
              </p>
            </NumberedClause>

            <NumberedClause num={2} title="Basic Terms of the Proposed Transaction.">
              <p>
                The terms of the Proposed Transaction are attached hereto as Investment Term Sheet and
                are further explained in Appendix A. During the Funding Period (defined in Section 5),
                the parties will negotiate and deliver the Loan Documents, including terms not presently
                contemplated by the parties, setting forth the rights and obligations of the parties
                with respect to the Proposed Transaction, subject to Section 1 above.
              </p>
            </NumberedClause>
          </PageBlock>

          {/* ---- Page 2 — Clauses 3-11 ---- */}
          <PageBlock>
            <LogoBar show={showLogo} />
            <div className="mt-6">
              <NumberedClause num={3} title="Timing.">
                <p>
                  The funding period for the Proposed Transaction will expire thirty (30) days from the
                  date hereof (the &ldquo;Funding Period&rdquo;).
                </p>
              </NumberedClause>

              <NumberedClause num={4} title="Confidentiality.">
                <p>
                  If the Proposed Transaction is abandoned or not consummated for any reason, each party,
                  at the request of the other party (the &ldquo;First Party&rdquo;), shall return to the
                  First Party or destroy, and shall cause its employees and agents to return to the First
                  Party or destroy all books, records and other documents and papers obtained from the
                  First Party and all copies thereof, and each party shall not disclose or use for any
                  purpose, and shall cause its agents not to disclose or use for any purpose, any
                  confidential data or information obtained from another party in the course of funding
                  regarding the Proposed Transaction.
                </p>
              </NumberedClause>

              <NumberedClause num={5} title="Collections Costs.">
                <p>
                  Borrower agrees to pay collections costs in the event that Borrower breaches. These
                  costs may include attorney fees and collection agency expenses.
                </p>
              </NumberedClause>

              <NumberedClause num={6} title="No Third Party Beneficiary; Assignability.">
                <p>
                  No person or entity other than the parties to this Letter shall have any rights under
                  this Letter. This Letter is not assignable by either party. Lender, however, retains all
                  rights necessary to transfer or assign subsequent promissory notes, in whole or in part,
                  at Lender&rsquo;s sole discretion.
                </p>
              </NumberedClause>

              <NumberedClause num={7} title="Exclusivity.">
                <p>
                  The parties agree that they will not discuss or negotiate a transaction involving
                  Borrower similar to the Proposed Transaction with any other party during the Funding
                  Period. If Borrower discusses or negotiates a transaction involving Borrower similar to
                  the Proposed Transaction with any other party during the Funding Period, Section 6
                  regarding breach applies.
                </p>
              </NumberedClause>

              <NumberedClause num={8} title="Payment.">
                <p>
                  Payments will be automatically debited via ACH transactions on the first of each month
                  based on the account information provided in the Borrower ACH Authorization Form. If
                  the Proposed Transaction involves cross-collateralization or more than one property and
                  Borrower sells one property before the rest, Borrower agrees to first use all sale
                  proceeds necessary to fully satisfy all obligations owed to Lender.
                </p>
              </NumberedClause>

              <NumberedClause num={9} title="Governing Law; Venue; Authority.">
                <p>
                  This Letter shall be governed by and construed in accordance with the laws in the state
                  where the property is located, without giving effect to the conflicts of law principles
                  thereof. Any dispute settlement, including negotiation, mediation, and/or arbitration,
                  will take place in New Jersey. Each person signing this Letter on behalf of a party has
                  authority to do so.
                </p>
              </NumberedClause>

              <NumberedClause num={10} title="Severability:">
                <p>
                  If any of the provisions of this Agreement becomes invalid, illegal or unenforceable in
                  any respect under any law, the validity, legality and enforceability of the remaining
                  provisions shall not in any way be affected or impaired.
                </p>
              </NumberedClause>

              <NumberedClause num={11} title="Dispute Settlement.">
                <p>
                  In the event of a dispute between Lender and Borrower regarding this document, or
                  arising from its interpretation, application, or enforcement, both parties agree to
                  first use their best effort to resolve the dispute by negotiation and compromise.
                  Failing that first step, either party may pursue any legal remedy to which it is
                  entitled. By entering into this contract, Borrower understands that they agree to waive
                  the right to a trial by jury or to participate in a class action. Each party agrees
                  that it may bring claims against the other only in its individual capacity and not as a
                  Plaintiff or Class Member in any purported class or representative proceeding.
                </p>
              </NumberedClause>
            </div>
          </PageBlock>

          {/* ---- Page 3 — Acceptance ---- */}
          <PageBlock>
            <LogoBar show={showLogo} />
            <div className="mt-8">
              <p className="font-semibold underline">Acceptance:</p>
              <p className="mt-3">
                By signing below, you acknowledge the terms and conditions of this Proposal. Upon receipt
                of the executed Proposal Letter and accompanying application fee, First Equity shall
                commence its investment approval process including a business, credit, legal and
                environmental investigation.
              </p>
              <p className="mt-3">
                If the foregoing accurately reflects your understanding, please so indicate by signing a
                copy of this Letter in the space provided below and returning it to me.
              </p>

              <div className="mt-10">
                <p>Confirmed and agreed to:</p>
                <div className="mt-8 flex items-end gap-12">
                  <div className="flex-1">
                    <div className="border-b border-gray-800 h-6"></div>
                    <p className="mt-1 text-xs">By: {borrowerName}</p>
                  </div>
                  <div className="w-40">
                    <div className="border-b border-gray-800 h-6"></div>
                    <p className="mt-1 text-xs">Date:</p>
                  </div>
                </div>
              </div>
            </div>
          </PageBlock>

          {/* ---- Page 4 — Appendix A ---- */}
          <PageBlock>
            <LogoBar show={showLogo} />
            <h2 className="text-center font-bold mt-8">Appendix A</h2>

            <div className="mt-4 border border-gray-300">
              <AppRow label="Borrower:" value={llcName} />
              <AppRow label="Lender:" value="First Equity Funding LP" />
              <AppRow label="Guarantor(s):" value={guarantors || borrowerName} />
              <AppRow label="Loan Program:" value={loanProgramLabel(loan.loan_type, loan.term_months)} />
              <AppRow label="Loan Amount:" value={fmtCurrencyCents(loan.loan_amount)} />
              <AppRow label="Loan Term:" value={termLabel(loan.term_months)} />
              <AppRow label="Rate Type:" value={details.rate_type ?? '—'} />
              <AppRow label="Amortization Schedule:" value={details.amortization_schedule ?? '—'} />

              {!isFixFlip && (
                <AppRow label="Prepayment Penalty:" value={details.prepayment_penalty ?? '—'} />
              )}

              <AppRow label="Interest Rate:" value={fmtRatePct(loan.interest_rate)} />

              {!isFixFlip ? (
                <AppRow
                  label="Monthly Payment:"
                  value={
                    <>
                      Years 1-{loan.term_months ? Math.round(loan.term_months / 12) : 30}:{' '}
                      {fmtCurrencyCents(monthly)} (does not include taxes and insurance) Taxes and
                      Insurance will be escrowed with monthly payment.
                    </>
                  }
                />
              ) : (
                <AppRow label="Monthly Payment:" value={fmtCurrencyCents(monthly)} />
              )}

              <AppRow label="Origination Fee:" value={fmtCurrencyCents(originationFee)} />
              <AppRow label="Broker Fee:" value={fmtCurrencyCents(brokerFee)} />
              <AppRow label="Commitment Fee:" value={fmtCurrencyCents(details.underwriting_fee)} />
              <AppRow label="Attorney Fee:" value={fmtCurrencyCents(details.legal_doc_prep_fee)} />
              <AppRow label="Desk Review Fee:" value={fmtCurrencyCents(details.desk_review_fee)} />
              <AppRow label="Small Balance Fee:" value={fmtCurrencyCents(details.small_balance_fee)} />

              {isFixFlip && (
                <>
                  <AppRow label="Feasibility Fee:" value={fmtCurrencyCents(details.feasibility_fee)} />
                  <AppRow label="Construction Holdback:" value={fmtCurrencyCents(details.construction_holdback)} />
                  <AppRow label="Construction Advance/Draw Fee:" value={fmtCurrencyCents(details.draw_fee)} />
                </>
              )}

              <AppRow label="Collateral:" value={collateral} />

              {isFixFlip && (
                <AppRow label="Initial Loan Amount:" value={fmtCurrencyCents(details.initial_loan_amount)} />
              )}

              <AppRow label="Purchase Price:" value={fmtCurrencyCents(details.purchase_price)} />

              {isFixFlip && (
                <AppRow label="Prepayment Penalty:" value={details.prepayment_penalty ?? '—'} />
              )}

              {!isFixFlip && (
                <AppRow
                  label="Insurance:"
                  value={
                    <>
                      All insurance (title, fire and theft, flood, extended coverage and liability and
                      life) are the responsibility of the borrower. The borrower will be responsible for
                      maintaining in force property insurance with companies and in amounts and
                      coverage&apos;s satisfactory with First Equity Capital, LLC.
                    </>
                  }
                />
              )}

              {!isFixFlip && (
                <AppRow
                  label="Expiration:"
                  value={`(30) Thirty days from the date of issue. ${fmtExpirationDate()}`}
                />
              )}
            </div>
          </PageBlock>

          {/* ---- Page 5 — Fix&Flip extras (3-month ext / insurance / expiration / additional fees) ---- */}
          {isFixFlip && (
            <PageBlock>
              <LogoBar show={showLogo} />
              <div className="mt-8 border border-gray-300">
                <AppRow
                  label="3 Month Extension:"
                  value={
                    <>
                      In the scenario where the loan exceeds the 12 month term, there is an option of a
                      (3) three month extension. For these (3) months the interest rate will remain the
                      same. There will be an additional 1% Origination Fee. After this (3) three month
                      extension, the loan will balloon and need to be paid back in full.
                    </>
                  }
                />
                <AppRow
                  label="Insurance:"
                  value={
                    <>
                      All insurance (title, fire and theft, flood, extended coverage and liability and
                      life) are the responsibility of the borrower. The borrower will be responsible for
                      maintaining in force property insurance with companies and in amounts and
                      coverage&apos;s satisfactory with First Equity Capital, LLC.
                    </>
                  }
                />
                <AppRow
                  label="Expiration:"
                  value={`(30) Thirty days from the date of issue. ${fmtExpirationDate()}`}
                />
                <AppRow
                  label="Additional Fees:"
                  value={
                    details.additional_fees || details.additional_fees_notes
                      ? `${fmtCurrencyCents(details.additional_fees)}${details.additional_fees_notes ? ` — ${details.additional_fees_notes}` : ''}`
                      : 'N/A'
                  }
                />
              </div>
            </PageBlock>
          )}

          {/* ---- Final page — FEES / TITLE / FLOOD / etc. boilerplate ---- */}
          <PageBlock>
            <LogoBar show={showLogo} />
            <div className="mt-8 space-y-4">
              <p>
                <span className="font-bold underline">FEES:</span> Borrower shall pay all third-party fees
                including, appraisal, insurance costs, title, escrow, inspection, and attorneys&rsquo;
                fees for Lender&rsquo;s counsel, and any other costs arising in connection with the
                closing. Lender&rsquo;s attorneys&rsquo; fees are in addition to the cost of searches
                and all standard closing costs. Lender reserves the right to directly select all third
                parties used in connection with both the Proposed Transaction. Upon the receipt of the
                borrower&rsquo;s signed loan term sheet the lender will charge an Application/Processing
                fee to the borrower.
              </p>

              <p>
                <span className="font-bold underline">TITLE INSURANCE:</span> At the closing, Lender will
                be provided with title insurance from a title company satisfactory to Lender in an amount
                not less than the Loan Amount, insuring that the Lender&apos;s mortgage is first lien on
                the Subject Property, free and clear of all other liens and encumbrances, whether recorded
                or not. The only title insurance underwriters acceptable to Lender are the Fidelity Title
                Group, First American Title Insurance Company, Stewart Title Guaranty Company, and Old
                Republic National Title Insurance Group.
              </p>

              {isFixFlip && (
                <p>
                  <span className="font-bold underline">GENERAL LIABILITY INSURANCE:</span> The Lender
                  requires the Borrower to provide a minimum of $1 Million dollars general liability
                  coverage on the Subject Property.
                </p>
              )}

              <p>
                <span className="font-bold underline">FLOOD CERTIFICATION:</span> Pursuant to the Federal
                Flood Disaster Protection Act of 1973, if the Subject Property is located in a flood
                hazard zone, the Borrower shall obtain flood insurance coverage after the issuance of the
                certificate of occupancy in the maximum amount available, or the Loan Amount, whichever
                is less. If the Subject Property is not in a flood hazard zone, Borrower will obtain a
                letter from insurance carrier affirming that fact.
              </p>

              <p>
                <span className="font-bold underline">LOAN DOCUMENTS:</span> The Loan shall be closed in
                accordance with the Lender&apos;s standard commercial mortgage loan documentation. It
                will contain such terms and conditions as are satisfactory to Lender.
              </p>

              <p>
                <span className="font-bold underline">LENDER&rsquo;S COUNSEL:</span> Lender&rsquo;s
                counsel will prepare the loan documentation on behalf of the Lender. Borrower agrees to
                pay the Lender&apos;s counsel&rsquo;s fee. The fee will be added to the closing statement
                to be paid by the borrower upon closing. If the closing does not occur after legal counsel
                has already been retained, borrower will still be responsible for paying any fees
                incurred.
              </p>

              <p>
                You are advised that the interests of the Borrower and Lender are or may be different and
                may conflict and that the Lender&rsquo;s attorney represents only the Lender and not the
                Borrower. The Borrower is advised to employ an attorney of the Borrower&rsquo;s choice
                licensed to practice law in this state to represent the interests of the Borrower.
              </p>

              <p>
                This Proposal constitutes only a general, non-binding expression of interest on part of
                First Equity. This proposal is subject to First Equity&rsquo;s credit, legal, and
                investment approval process and is not intended to and does not create a legally binding
                commitment or obligation on the part of First Equity. The creation of such a legally
                binding commitment or obligation is subject to, among other things, the completion by
                First Equity of an in-depth investigation of the proposed investment, the results of
                which are deemed satisfactory by Lender and the negotiation, execution and delivery of
                definitive documents which are mutually agreed upon by borrower and Lender and no
                occurrence of a material adverse change in business, financial condition, or prospect of
                borrower or any guarantor. This proposal is provided solely for your benefit and shall
                not be reproduced, distributed, quoted, or otherwise made reference to except between the
                senior management, officers and legal counsel of the borrower. Please review and sign and
                send back to First Equity.
              </p>
            </div>
          </PageBlock>
        </div>
      </div>
    </>
  )
}

// ---- Layout primitives ----

function PrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        .no-print { display: none !important; }
        .letter-page { padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
        body { background: white !important; }
        .page-block { page-break-after: always; }
        .page-block:last-child { page-break-after: auto; }
        @page { margin: 0.5in; size: letter; }
      }
      .editable-text {
        background: transparent;
        border: 1px dashed transparent;
        padding: 2px 4px;
        border-radius: 4px;
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        color: inherit;
        outline: none;
      }
      .editable-text:hover { border-color: #d1d5db; }
      .editable-text:focus { border-color: #9ca3af; background: #fafafa; }
      @media print {
        .editable-text { border: none !important; padding: 0 !important; background: transparent !important; }
      }
    `}</style>
  )
}

function LogoBar({ show = true }: { show?: boolean }) {
  // Hidden on broker-assigned loans — keep a same-height spacer so the
  // page's top spacing is unchanged.
  if (!show) return <div className="h-12" aria-hidden />
  return (
    <Image
      src="/logo-main.png"
      alt="First Equity Funding"
      width={724}
      height={86}
      className="h-12 w-auto"
      priority
    />
  )
}

function PageBlock({ children }: { children: React.ReactNode }) {
  return <div className="page-block pb-6 print:pb-0 mb-6 print:mb-0">{children}</div>
}

function NumberedClause({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p>
        {num}. <span className="underline">{title}</span>
      </p>
      <div className="mt-1 pl-4">{children}</div>
    </div>
  )
}

function AppRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[2fr_3fr] border-b last:border-b-0 border-gray-300">
      <div className="px-3 py-2 border-r border-gray-300">{label}</div>
      <div className="px-3 py-2">{value}</div>
    </div>
  )
}
