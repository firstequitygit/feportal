// React-PDF version of the Committee Review Sheet (UNDERWRITING
// OVERVIEW). Produces a downloadable PDF instead of relying on the
// browser print dialog. Mirrors the field set from the HTML version
// in src/components/committee-review-sheet.tsx — same DSCR vs
// Fix&Flip variants, same blank rows for fields the UW fills by hand.

import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import {
  fmtCurrency,
  fmtLetterDate,
  fmtRatePct,
  fmtRatio,
  calcOriginationFee,
  calcBrokerFee,
  calcMonthlyPayment,
  calcDSCR,
} from '@/lib/loan-doc-format'

const COMPANY_ADDRESS_LINE = '1330 Laurel Avenue, Suite 101 Sea Girt | New Jersey | 08750'
const COMPANY_PHONE_LINE = 'P: 732-359-7800 | F: 732-907-1913'

export interface CommitteeReviewLoan {
  loan_type: string | null
  loan_number: string | null
  loan_amount: number | null
  interest_rate: number | null
  arv: number | null
  rehab_budget: number | null
  term_months: number | null
  interest_only: string | null
  entity_name: string | null
  property_address: string | null
}

export interface CommitteeReviewDetails {
  loan_type_one: string | null
  credit_score: number | null
  points: number | null
  broker_points: number | null
  purchase_price: number | null
  value_as_is: number | null
  initial_loan_amount: number | null
  underwriting_fee: number | null
  exceptions: string | null
  qualifying_rent: number | null
  annual_property_tax: number | null
  annual_insurance_premium: number | null
  annual_flood_insurance: number | null
  annual_hoa_dues: number | null
  amortization_schedule: string | null
}

export interface CommitteeReviewInput {
  loan: CommitteeReviewLoan
  details: CommitteeReviewDetails
  borrowerName: string | null
  coBorrowerNames: string[]
  loanOfficerName: string | null
  brokerName: string | null
  /** Letter date string already formatted (e.g. "06/09/2026"). Pass
   *  from the UI so the date the UW sees in the preview matches the
   *  date that prints. Defaults to today if not supplied. */
  letterDate?: string
}

// Lazy-load the logo bitmap once per serverless container.
let cachedLogo: Buffer | null = null
function getLogoBuffer(): Buffer | null {
  if (cachedLogo) return cachedLogo
  try {
    cachedLogo = fs.readFileSync(path.join(process.cwd(), 'public', 'logo-main.png'))
    return cachedLogo
  } catch (err) {
    console.error('[committee-review-pdf] failed to load logo:', err)
    return null
  }
}

// All measurements are in PDF points (72 per inch). Layout targets a
// 1-page letter — the HTML version fit on a single page with 0.5in
// margins and we mirror that here.
const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontSize: 9,
    color: '#111827',
    fontFamily: 'Helvetica',
    lineHeight: 1.25,
  },
  // Letterhead row — logo flush to the left margin, contact lines
  // flush to the right margin.
  //
  // logo-main.png is actually 766x264 (ratio ~2.9:1) — NOT the
  // 724x86 the next/image props elsewhere suggest. Earlier boxes
  // used the wrong ratio, so objectFit:contain letterboxed the
  // image and centered it inside a too-wide box, leaving a dead
  // gap at the left margin. Box now matches the real ratio so the
  // bitmap fills it edge-to-edge, flush left.
  letterhead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    width: 155,
    height: 53.4, // 155 / 766 * 264 ≈ 53.4 — 50% larger than the prior visible size
    objectFit: 'contain',
    alignSelf: 'flex-start',
  },
  brandWordmark: {
    color: '#1F5D8F',
    fontFamily: 'Helvetica-Bold',
    fontSize: 20,
  },
  contactBlock: {
    fontSize: 8,
    color: '#374151',
    textAlign: 'right',
    lineHeight: 1.2,
  },
  // Title row — section heading + date.
  titleRow: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  titleDate: {
    fontSize: 9,
  },
  // Grid table — used by 2/3/4/6-column variants.
  gridTable: {
    borderTop: '1pt solid #d1d5db',
    borderLeft: '1pt solid #d1d5db',
    marginTop: 6,
  },
  gridHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
  },
  gridValueRow: {
    flexDirection: 'row',
  },
  gridHeaderCell: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRight: '1pt solid #d1d5db',
    borderBottom: '1pt solid #d1d5db',
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textAlign: 'center',
  },
  gridValueCell: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRight: '1pt solid #d1d5db',
    borderBottom: '1pt solid #d1d5db',
    fontSize: 8.5,
    minHeight: 18,
  },
  // 2-col label/value list — used for the people/fees/exceptions
  // block. Label cell is narrower (1fr) and the value cell wider (2fr).
  kvTable: {
    marginTop: 10,
    borderTop: '1pt solid #d1d5db',
    borderLeft: '1pt solid #d1d5db',
    borderRight: '1pt solid #d1d5db',
  },
  kvRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #d1d5db',
  },
  kvLabelCell: {
    width: '33%',
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: '#f9fafb',
    borderRight: '1pt solid #d1d5db',
    fontSize: 8.5,
  },
  kvValueCell: {
    width: '67%',
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 8.5,
    minHeight: 20,
  },
  // 30-Year Loans block (DSCR only).
  sectionHeading: {
    marginTop: 14,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
  },
})

interface GridProps {
  headers: string[]
  values: string[]
  cols: number
}

function GridTable({ headers, values, cols }: GridProps) {
  const widthPct = `${100 / cols}%`
  return (
    <View style={styles.gridTable}>
      <View style={styles.gridHeaderRow}>
        {headers.map((h, i) => (
          <Text key={i} style={[styles.gridHeaderCell, { width: widthPct as `${number}%` }]}>
            {h}
          </Text>
        ))}
      </View>
      <View style={styles.gridValueRow}>
        {values.map((v, i) => (
          <Text key={i} style={[styles.gridValueCell, { width: widthPct as `${number}%` }]}>
            {v}
          </Text>
        ))}
      </View>
    </View>
  )
}

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow} wrap={false}>
      <Text style={styles.kvLabelCell}>{label}</Text>
      <Text style={styles.kvValueCell}>{value}</Text>
    </View>
  )
}

function HeaderLogo() {
  const logo = getLogoBuffer()
  if (logo) return <Image src={logo} style={styles.logo} />
  return <Text style={styles.brandWordmark}>First Equity Funding</Text>
}

export async function renderCommitteeReviewPdf(input: CommitteeReviewInput): Promise<Buffer> {
  const { loan, details, borrowerName, coBorrowerNames, loanOfficerName, brokerName, letterDate } = input

  const isDscr = loan.loan_type === 'Rental (DSCR)'
  const date = letterDate?.trim() || fmtLetterDate()

  // Derived calcs — mirror the HTML component verbatim.
  const originationFee = calcOriginationFee(loan.loan_amount, details.points)
  const brokerFee = calcBrokerFee(loan.loan_amount, details.broker_points)
  const commitmentFee = details.underwriting_fee // Commitment Fee maps to Underwriting Fee

  const loanOverPurchase =
    loan.loan_amount && details.purchase_price
      ? loan.loan_amount / details.purchase_price
      : null
  const loanOverAsIs =
    loan.loan_amount && details.value_as_is
      ? loan.loan_amount / details.value_as_is
      : null

  const initialOverTotalCost =
    details.initial_loan_amount && details.purchase_price !== null && details.purchase_price !== undefined && details.value_as_is !== null
      ? details.initial_loan_amount /
        ((details.purchase_price ?? 0) + (loan.rehab_budget ?? 0))
      : null
  const initialOverAsIs =
    details.initial_loan_amount && details.value_as_is
      ? details.initial_loan_amount / details.value_as_is
      : null
  const loanToArv =
    loan.loan_amount && loan.arv ? loan.loan_amount / loan.arv : null

  const monthly = calcMonthlyPayment(
    loan.loan_amount,
    loan.interest_rate,
    loan.term_months,
    loan.interest_only,
    details.amortization_schedule,
  )
  const dscr = isDscr
    ? calcDSCR(
        details.qualifying_rent,
        monthly,
        details.annual_property_tax,
        details.annual_insurance_premium,
        details.annual_flood_insurance,
        details.annual_hoa_dues,
      )
    : null

  const doc = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.letterhead}>
          <HeaderLogo />
          <View style={styles.contactBlock}>
            <Text>{COMPANY_ADDRESS_LINE}</Text>
            <Text>{COMPANY_PHONE_LINE}</Text>
          </View>
        </View>

        {/* Title + date */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>UNDERWRITING OVERVIEW</Text>
          <Text style={styles.titleDate}>{date}</Text>
        </View>

        {/* Identity rows */}
        <GridTable
          cols={4}
          headers={['Borrower', 'Co-Borrower(s)', 'LLC/Entity Name', 'Property Address']}
          values={[
            borrowerName ?? '',
            coBorrowerNames.join(', '),
            loan.entity_name ?? '',
            loan.property_address ?? '',
          ]}
        />
        <GridTable
          cols={3}
          headers={['Loan Number', 'Loan Type', 'Loan Purpose']}
          values={[loan.loan_number ?? '', loan.loan_type ?? '', details.loan_type_one ?? '']}
        />
        <GridTable
          cols={3}
          headers={['Credit Score', 'Interest Rate', 'Points']}
          values={[
            details.credit_score !== null && details.credit_score !== undefined ? String(details.credit_score) : '',
            fmtRatePct(loan.interest_rate),
            details.points !== null && details.points !== undefined ? String(details.points) : '0',
          ]}
        />

        {/* Money rows — variant-dependent */}
        {isDscr ? (
          <>
            <GridTable
              cols={3}
              headers={['Contract Sales Price', '"As-is" Value', 'Loan Amount']}
              values={[
                fmtCurrency(details.purchase_price),
                fmtCurrency(details.value_as_is),
                fmtCurrency(loan.loan_amount),
              ]}
            />
            <GridTable
              cols={2}
              headers={['Loan/Total Cost', 'Loan/As-Is']}
              values={[fmtRatio(loanOverPurchase), fmtRatio(loanOverAsIs)]}
            />
          </>
        ) : (
          <>
            <GridTable
              cols={6}
              headers={[
                'Contract Sales Price',
                '"As-is" Value',
                'Construction Cost',
                'After Repaired Value',
                'Initial Loan Amount',
                'Loan Amount',
              ]}
              values={[
                fmtCurrency(details.purchase_price),
                fmtCurrency(details.value_as_is),
                fmtCurrency(loan.rehab_budget),
                fmtCurrency(loan.arv),
                fmtCurrency(details.initial_loan_amount),
                fmtCurrency(loan.loan_amount),
              ]}
            />
            <GridTable
              cols={4}
              headers={['Money Multiple', 'Initial Loan/Total Cost', 'Initial Loan/As-Is', 'Loan to ARV']}
              values={[
                '', // blank placeholder — UW fills by hand
                fmtRatio(initialOverTotalCost),
                fmtRatio(initialOverAsIs),
                fmtRatio(loanToArv),
              ]}
            />
          </>
        )}

        {/* People / fees / exceptions */}
        <View style={styles.kvTable}>
          <KvRow label="Loan Originator" value={loanOfficerName ?? ''} />
          <KvRow label="Broker" value={brokerName ?? ''} />
          <KvRow label="Broker Fee" value={fmtCurrency(brokerFee)} />
          <KvRow label="Wholesaler Profits" value="" />
          <KvRow label="Origination Fee" value={fmtCurrency(originationFee)} />
          <KvRow label="Commitment Fee" value={fmtCurrency(commitmentFee)} />
          {!isDscr && <KvRow label="Properties Verified?" value="" />}
          <KvRow label="Exceptions Note(s)" value={details.exceptions ?? ''} />
          {isDscr && (
            <>
              <KvRow label="DSCR" value={dscr !== null ? dscr.toFixed(2) : '0'} />
              <KvRow label="Sizer Date" value="" />
            </>
          )}
        </View>

        {/* DSCR-only: 30 Year Loans block */}
        {isDscr && (
          <>
            <Text style={styles.sectionHeading}>30 Year Loans</Text>
            <View style={styles.kvTable}>
              <KvRow label="Tax" value={fmtCurrency(details.annual_property_tax)} />
              <KvRow label="HOI Premium" value={fmtCurrency(details.annual_insurance_premium)} />
              <KvRow label="Flood" value={fmtCurrency(details.annual_flood_insurance)} />
            </View>
          </>
        )}
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
