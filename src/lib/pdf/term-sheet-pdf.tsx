// React-PDF version of the Loan Term Sheet. Produces a proper
// downloadable PDF (vs. the browser-print version that's been having
// font-rendering issues with lowercase "l"s). Mirrors the same field
// set the HTML version uses; layout is tightened so Clauses 3-11 +
// the Acceptance block both fit on Page 2 (saving a page over the
// original Airtable templates).

import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
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

export interface TermSheetLoan {
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

export interface TermSheetDetails {
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

export interface TermSheetBorrower {
  full_name: string | null
  current_address_street: string | null
  current_address_city: string | null
  current_address_state: string | null
  current_address_zip: string | null
}

export interface TermSheetInput {
  loan: TermSheetLoan
  details: TermSheetDetails
  borrower: TermSheetBorrower | null
  coBorrowerNames: string[]
}

// Lazy-load the logo bitmap from the public folder once per
// serverless container. React-PDF's <Image> accepts a Buffer
// directly, which avoids round-tripping through a URL fetch
// when the renderer runs server-side.
let cachedLogo: Buffer | null = null
function getLogoBuffer(): Buffer | null {
  if (cachedLogo) return cachedLogo
  try {
    cachedLogo = fs.readFileSync(path.join(process.cwd(), 'public', 'logo-main.png'))
    return cachedLogo
  } catch (err) {
    console.error('[term-sheet-pdf] failed to load logo from public/logo-main.png:', err)
    return null
  }
}

// Use Helvetica everywhere — built-in PDF font, no embedding
// surprises and renders lowercase l's correctly in Acrobat /
// browsers / Preview.
const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 48,
    fontSize: 9.5,
    color: '#111827',
    fontFamily: 'Helvetica',
    lineHeight: 1.35,
  },
  // Logo bitmap from public/logo-main.png. Source is 724x86 (ratio
  // 8.42:1). React-PDF treats width:'auto' on <Image> as "fill the
  // container," which stretches the logo horizontally — so we pin
  // both dimensions to the natural ratio and center it.
  logo: {
    width: 240,
    height: 28.5, // 240 / 724 * 86 ≈ 28.5
    objectFit: 'contain',
    alignSelf: 'center',
    marginBottom: 14,
  },
  // Text fallback used only if the logo file can't be read at
  // runtime — keeps the doc from rendering completely empty up top.
  brandWordmark: {
    color: '#1F5D8F',
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    letterSpacing: -0.3,
    marginBottom: 14,
  },
  centerTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  centerDate: {
    fontSize: 9.5,
    textAlign: 'center',
    marginTop: 4,
  },
  addressBlock: {
    marginTop: 18,
  },
  paragraph: {
    marginTop: 8,
    textAlign: 'justify',
  },
  paragraphTight: {
    marginTop: 5,
    textAlign: 'justify',
  },
  clauseNumber: {
    marginTop: 8,
    fontFamily: 'Helvetica',
  },
  clauseTitleUnderline: {
    textDecoration: 'underline',
    fontFamily: 'Helvetica',
  },
  clauseBody: {
    marginTop: 3,
    paddingLeft: 14,
    textAlign: 'justify',
  },
  subClause: {
    marginTop: 3,
  },
  // Appendix A table
  appRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #d1d5db',
  },
  appRowLast: {
    flexDirection: 'row',
  },
  appLabelCell: {
    width: '38%',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRight: '1pt solid #d1d5db',
  },
  appValueCell: {
    width: '62%',
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  appTable: {
    marginTop: 14,
    borderTop: '1pt solid #d1d5db',
    borderLeft: '1pt solid #d1d5db',
    borderRight: '1pt solid #d1d5db',
  },
  appHeader: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 4,
  },
  // Acceptance block
  acceptanceTitle: {
    marginTop: 12,
    fontFamily: 'Helvetica-Bold',
    textDecoration: 'underline',
  },
  signatureRow: {
    flexDirection: 'row',
    marginTop: 26,
    gap: 24,
  },
  signatureLineBox: {
    flex: 1,
  },
  signatureLine: {
    borderBottom: '1pt solid #111827',
    height: 14,
  },
  signatureLabel: {
    fontSize: 8.5,
    marginTop: 2,
  },
  dateBox: {
    width: 110,
  },
  // Boilerplate page
  boilerHeading: {
    fontFamily: 'Helvetica-Bold',
    textDecoration: 'underline',
  },
})

// Header logo at the top of each page. Falls back to the
// "First Equity Funding" brand wordmark if the bitmap couldn't
// be read (e.g., asset missing on disk).
function HeaderLogo() {
  const logo = getLogoBuffer()
  if (logo) return <Image src={logo} style={styles.logo} />
  return <Text style={styles.brandWordmark}>First Equity Funding</Text>
}

// Reusable inline labels for clauses — keeps each clause readable
// without a separate component per item.
function Clause({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.clauseNumber}>
        {num}.{' '}
        <Text style={styles.clauseTitleUnderline}>{title}</Text>
      </Text>
      <View style={styles.clauseBody}>{children}</View>
    </View>
  )
}

function AppRow({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <View style={last ? styles.appRowLast : styles.appRow} wrap={false}>
      <Text style={styles.appLabelCell}>{label}</Text>
      <Text style={styles.appValueCell}>{value}</Text>
    </View>
  )
}

export async function renderTermSheetPdf(input: TermSheetInput): Promise<Buffer> {
  const { loan, details, borrower, coBorrowerNames } = input

  const isFixFlip = loan.loan_type === 'Fix & Flip (Bridge)' || loan.loan_type === 'New Construction'
  const llcName = loan.entity_name ?? '—'
  const borrowerName = borrower?.full_name ?? '—'
  const borrowerAddress = composePropertyAddress(
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

  const originationFee = calcOriginationFee(loan.loan_amount, details.points)
  const brokerFee = calcBrokerFee(loan.loan_amount, details.broker_points)
  const monthly = calcMonthlyPayment(
    loan.loan_amount,
    loan.interest_rate,
    loan.term_months,
    loan.interest_only,
    details.amortization_schedule,
  )

  const letterDate = fmtLetterDate()
  const expirationLine = `(30) Thirty days from the date of issue. ${fmtExpirationDate()}`

  const doc = (
    <Document>
      {/* ====== Page 1 — Cover + Clauses 1-2 ====== */}
      <Page size="LETTER" style={styles.page}>
        <HeaderLogo />

        <Text style={styles.centerTitle}>LOAN TERM SHEET</Text>
        <Text style={styles.centerDate}>{letterDate}</Text>

        <View style={styles.addressBlock}>
          <Text>{llcName}</Text>
          <Text>{borrowerName}</Text>
          <Text>{borrowerAddress}</Text>
        </View>

        <Text style={styles.paragraph}>Dear {borrowerName},</Text>

        <Text style={styles.paragraph}>
          First Equity Capital, LLC (&ldquo;First Equity&rdquo;) is pleased to present to you the
          following loan proposal. The costs outlined herein are estimates. The creation of a
          legally binding commitment or obligation is subject to the delivery of documents requested
          by First Equity, final approval of the Borrower&rsquo;s request for a loan and the
          execution and delivery of an agreement by both Borrower and First Equity to the
          transactions contemplated hereby, and the consummation of such transactions will be
          subject to the satisfaction of the conditions set forth therein.
        </Text>

        <Text style={styles.paragraphTight}>
          This Loan Term Sheet Letter (&ldquo;Letter&rdquo;) outlines the proposed transaction
          between First Equity a New Jersey limited liability company (&ldquo;Lender&rdquo;), and,{' '}
          {llcName}, (&ldquo;Borrower&rdquo;), pursuant to which Lender would lend funds to Borrower
          (the &ldquo;Proposed Transaction&rdquo;). This Letter supersedes any prior letters or
          discussions regarding the Proposed Transaction.
        </Text>

        <Clause num={1} title="Limited Binding Effect.">
          <Text>
            (a) Except as provided in subsections (b) and (c) below, this Letter does not create,
            and is not intended to create, an offer capable of acceptance, or acceptance of any
            offer previously made, nor create or memorialize any binding legal or contractual
            obligations on the part of either party, but is intended merely to provide a basis upon
            which the parties can continue to consider this matter, execute and deliver a definitive
            agreement, including a note, mortgage and other necessary loan documents (collectively,
            the &ldquo;Loan Documents&rdquo;).
          </Text>
          <Text style={styles.subClause}>
            (b) Notwithstanding the foregoing subsection (a), Sections 3, 4, 5, 6 and 7 of this
            Letter are intended to create binding legal and contractual obligations of the parties
            with respect to matters set forth therein, and upon the breach by a party of its
            obligations under any of Sections 3, 4, 5, 6 and 7 in any respect, the injured party
            shall have such rights and remedies with respect thereto as are available to it under
            applicable law.
          </Text>
          <Text style={styles.subClause}>
            (c) Upon execution and delivery of the Loan Documents, this Letter shall be superseded
            thereby and the rights and obligations of the parties with respect to the Proposed
            Transaction shall thereafter be governed by the Loan Documents.
          </Text>
        </Clause>

        <Clause num={2} title="Basic Terms of the Proposed Transaction.">
          <Text>
            The terms of the Proposed Transaction are attached hereto as Investment Term Sheet and
            are further explained in Appendix A. During the Funding Period (defined in Section 5),
            the parties will negotiate and deliver the Loan Documents, including terms not presently
            contemplated by the parties, setting forth the rights and obligations of the parties
            with respect to the Proposed Transaction, subject to Section 1 above.
          </Text>
        </Clause>

        <Clause num={3} title="Timing.">
          <Text>
            The funding period for the Proposed Transaction will expire thirty (30) days from the
            date hereof (the &ldquo;Funding Period&rdquo;).
          </Text>
        </Clause>

        <Clause num={4} title="Confidentiality.">
          <Text>
            If the Proposed Transaction is abandoned or not consummated for any reason, each party,
            at the request of the other party (the &ldquo;First Party&rdquo;), shall return to the
            First Party or destroy, and shall cause its employees and agents to return to the First
            Party or destroy all books, records and other documents and papers obtained from the
            First Party and all copies thereof, and each party shall not disclose or use for any
            purpose, and shall cause its agents not to disclose or use for any purpose, any
            confidential data or information obtained from another party in the course of funding
            regarding the Proposed Transaction.
          </Text>
        </Clause>
      </Page>

      {/* ====== Page 2 — Clauses 5-11 + Acceptance (fits on one page) ====== */}
      <Page size="LETTER" style={styles.page}>
        <HeaderLogo />

        <Clause num={5} title="Collections Costs.">
          <Text>
            Borrower agrees to pay collections costs in the event that Borrower breaches. These
            costs may include attorney fees and collection agency expenses.
          </Text>
        </Clause>

        <Clause num={6} title="No Third Party Beneficiary; Assignability.">
          <Text>
            No person or entity other than the parties to this Letter shall have any rights under
            this Letter. This Letter is not assignable by either party. Lender, however, retains
            all rights necessary to transfer or assign subsequent promissory notes, in whole or in
            part, at Lender&rsquo;s sole discretion.
          </Text>
        </Clause>

        <Clause num={7} title="Exclusivity.">
          <Text>
            The parties agree that they will not discuss or negotiate a transaction involving
            Borrower similar to the Proposed Transaction with any other party during the Funding
            Period. If Borrower discusses or negotiates a transaction involving Borrower similar to
            the Proposed Transaction with any other party during the Funding Period, Section 6
            regarding breach applies.
          </Text>
        </Clause>

        <Clause num={8} title="Payment.">
          <Text>
            Payments will be automatically debited via ACH transactions on the first of each month
            based on the account information provided in the Borrower ACH Authorization Form. If
            the Proposed Transaction involves cross-collateralization or more than one property and
            Borrower sells one property before the rest, Borrower agrees to first use all sale
            proceeds necessary to fully satisfy all obligations owed to Lender.
          </Text>
        </Clause>

        <Clause num={9} title="Governing Law; Venue; Authority.">
          <Text>
            This Letter shall be governed by and construed in accordance with the laws in the state
            where the property is located, without giving effect to the conflicts of law principles
            thereof. Any dispute settlement, including negotiation, mediation, and/or arbitration,
            will take place in New Jersey. Each person signing this Letter on behalf of a party has
            authority to do so.
          </Text>
        </Clause>

        <Clause num={10} title="Severability:">
          <Text>
            If any of the provisions of this Agreement becomes invalid, illegal or unenforceable in
            any respect under any law, the validity, legality and enforceability of the remaining
            provisions shall not in any way be affected or impaired.
          </Text>
        </Clause>

        <Clause num={11} title="Dispute Settlement.">
          <Text>
            In the event of a dispute between Lender and Borrower regarding this document, or
            arising from its interpretation, application, or enforcement, both parties agree to
            first use their best effort to resolve the dispute by negotiation and compromise.
            Failing that first step, either party may pursue any legal remedy to which it is
            entitled. By entering into this contract, Borrower understands that they agree to waive
            the right to a trial by jury or to participate in a class action. Each party agrees
            that it may bring claims against the other only in its individual capacity and not as a
            Plaintiff or Class Member in any purported class or representative proceeding.
          </Text>
        </Clause>

        {/* Acceptance compressed into the same page */}
        <Text style={styles.acceptanceTitle}>Acceptance:</Text>
        <Text style={styles.paragraphTight}>
          By signing below, you acknowledge the terms and conditions of this Proposal. Upon receipt
          of the executed Proposal Letter and accompanying application fee, First Equity shall
          commence its investment approval process including a business, credit, legal and
          environmental investigation.
        </Text>
        <Text style={styles.paragraphTight}>
          If the foregoing accurately reflects your understanding, please so indicate by signing a
          copy of this Letter in the space provided below and returning it to me.
        </Text>
        <Text style={styles.paragraphTight}>Confirmed and agreed to:</Text>
        <View style={styles.signatureRow}>
          <View style={styles.signatureLineBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>By: {borrowerName}</Text>
          </View>
          <View style={styles.dateBox}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Date:</Text>
          </View>
        </View>
      </Page>

      {/* ====== Page 3 — Appendix A ====== */}
      <Page size="LETTER" style={styles.page}>
        <HeaderLogo />
        <Text style={styles.appHeader}>Appendix A</Text>

        <View style={styles.appTable}>
          <AppRow label="Borrower:" value={llcName} />
          <AppRow label="Lender:" value="First Equity Funding LP" />
          <AppRow label="Guarantor(s):" value={guarantors || borrowerName} />
          <AppRow label="Loan Program:" value={loanProgramLabel(loan.loan_type, loan.term_months)} />
          <AppRow label="Loan Amount:" value={fmtCurrencyCents(loan.loan_amount)} />
          <AppRow label="Loan Term:" value={termLabel(loan.term_months)} />
          <AppRow label="Rate Type:" value={details.rate_type ?? '—'} />
          <AppRow label="Amortization Schedule:" value={details.amortization_schedule ?? '—'} />
          {!isFixFlip && <AppRow label="Prepayment Penalty:" value={details.prepayment_penalty ?? '—'} />}
          <AppRow label="Interest Rate:" value={fmtRatePct(loan.interest_rate)} />
          <AppRow
            label="Monthly Payment:"
            value={
              !isFixFlip
                ? `Years 1-${loan.term_months ? Math.round(loan.term_months / 12) : 30}: ${fmtCurrencyCents(monthly)} (does not include taxes and insurance) Taxes and Insurance will be escrowed with monthly payment.`
                : fmtCurrencyCents(monthly)
            }
          />
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
          {isFixFlip && <AppRow label="Initial Loan Amount:" value={fmtCurrencyCents(details.initial_loan_amount)} />}
          <AppRow label="Purchase Price:" value={fmtCurrencyCents(details.purchase_price)} />
          {isFixFlip && <AppRow label="Prepayment Penalty:" value={details.prepayment_penalty ?? '—'} />}
          {!isFixFlip && (
            <>
              <AppRow
                label="Insurance:"
                value="All insurance (title, fire and theft, flood, extended coverage and liability and life) are the responsibility of the borrower. The borrower will be responsible for maintaining in force property insurance with companies and in amounts and coverage's satisfactory with First Equity Capital, LLC."
              />
              <AppRow label="Expiration:" value={expirationLine} last />
            </>
          )}
          {isFixFlip && (
            <>
              <AppRow
                label="3 Month Extension:"
                value="In the scenario where the loan exceeds the 12 month term, there is an option of a (3) three month extension. For these (3) months the interest rate will remain the same. There will be an additional 1% Origination Fee. After this (3) three month extension, the loan will balloon and need to be paid back in full."
              />
              <AppRow
                label="Insurance:"
                value="All insurance (title, fire and theft, flood, extended coverage and liability and life) are the responsibility of the borrower. The borrower will be responsible for maintaining in force property insurance with companies and in amounts and coverage's satisfactory with First Equity Capital, LLC."
              />
              <AppRow label="Expiration:" value={expirationLine} />
              <AppRow
                label="Additional Fees:"
                value={
                  details.additional_fees || details.additional_fees_notes
                    ? `${fmtCurrencyCents(details.additional_fees)}${details.additional_fees_notes ? ` — ${details.additional_fees_notes}` : ''}`
                    : 'N/A'
                }
                last
              />
            </>
          )}
        </View>
      </Page>

      {/* ====== Final page — FEES / TITLE / FLOOD / etc. boilerplate ====== */}
      <Page size="LETTER" style={styles.page}>
        <HeaderLogo />

        <Text style={styles.paragraph}>
          <Text style={styles.boilerHeading}>FEES:</Text> Borrower shall pay all third-party fees
          including, appraisal, insurance costs, title, escrow, inspection, and attorneys&rsquo;
          fees for Lender&rsquo;s counsel, and any other costs arising in connection with the
          closing. Lender&rsquo;s attorneys&rsquo; fees are in addition to the cost of searches and
          all standard closing costs. Lender reserves the right to directly select all third
          parties used in connection with both the Proposed Transaction. Upon the receipt of the
          borrower&rsquo;s signed loan term sheet the lender will charge an Application/Processing
          fee to the borrower.
        </Text>

        <Text style={styles.paragraph}>
          <Text style={styles.boilerHeading}>TITLE INSURANCE:</Text> At the closing, Lender will be
          provided with title insurance from a title company satisfactory to Lender in an amount
          not less than the Loan Amount, insuring that the Lender&apos;s mortgage is first lien on
          the Subject Property, free and clear of all other liens and encumbrances, whether recorded
          or not. The only title insurance underwriters acceptable to Lender are the Fidelity Title
          Group, First American Title Insurance Company, Stewart Title Guaranty Company, and Old
          Republic National Title Insurance Group.
        </Text>

        {isFixFlip && (
          <Text style={styles.paragraph}>
            <Text style={styles.boilerHeading}>GENERAL LIABILITY INSURANCE:</Text> The Lender
            requires the Borrower to provide a minimum of $1 Million dollars general liability
            coverage on the Subject Property.
          </Text>
        )}

        <Text style={styles.paragraph}>
          <Text style={styles.boilerHeading}>FLOOD CERTIFICATION:</Text> Pursuant to the Federal
          Flood Disaster Protection Act of 1973, if the Subject Property is located in a flood
          hazard zone, the Borrower shall obtain flood insurance coverage after the issuance of the
          certificate of occupancy in the maximum amount available, or the Loan Amount, whichever
          is less. If the Subject Property is not in a flood hazard zone, Borrower will obtain a
          letter from insurance carrier affirming that fact.
        </Text>

        <Text style={styles.paragraph}>
          <Text style={styles.boilerHeading}>LOAN DOCUMENTS:</Text> The Loan shall be closed in
          accordance with the Lender&apos;s standard commercial mortgage loan documentation. It
          will contain such terms and conditions as are satisfactory to Lender.
        </Text>

        <Text style={styles.paragraph}>
          <Text style={styles.boilerHeading}>LENDER&rsquo;S COUNSEL:</Text> Lender&rsquo;s counsel
          will prepare the loan documentation on behalf of the Lender. Borrower agrees to pay the
          Lender&apos;s counsel&rsquo;s fee. The fee will be added to the closing statement to be
          paid by the borrower upon closing. If the closing does not occur after legal counsel has
          already been retained, borrower will still be responsible for paying any fees incurred.
        </Text>

        <Text style={styles.paragraph}>
          You are advised that the interests of the Borrower and Lender are or may be different and
          may conflict and that the Lender&rsquo;s attorney represents only the Lender and not the
          Borrower. The Borrower is advised to employ an attorney of the Borrower&rsquo;s choice
          licensed to practice law in this state to represent the interests of the Borrower.
        </Text>

        <Text style={styles.paragraph}>
          This Proposal constitutes only a general, non-binding expression of interest on part of
          First Equity. This proposal is subject to First Equity&rsquo;s credit, legal, and
          investment approval process and is not intended to and does not create a legally binding
          commitment or obligation on the part of First Equity. The creation of such a legally
          binding commitment or obligation is subject to, among other things, the completion by
          First Equity of an in-depth investigation of the proposed investment, the results of which
          are deemed satisfactory by Lender and the negotiation, execution and delivery of
          definitive documents which are mutually agreed upon by borrower and Lender and no
          occurrence of a material adverse change in business, financial condition, or prospect of
          borrower or any guarantor. This proposal is provided solely for your benefit and shall
          not be reproduced, distributed, quoted, or otherwise made reference to except between the
          senior management, officers and legal counsel of the borrower. Please review and sign and
          send back to First Equity.
        </Text>
      </Page>
    </Document>
  )

  return await renderToBuffer(doc)
}
