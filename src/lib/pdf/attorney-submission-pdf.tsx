// React-PDF version of the Attorney Submission Summary. Produces a
// downloadable PDF instead of relying on the browser print dialog.
// Mirrors the field list from the HTML version in
// src/components/attorney-submission-summary.tsx.

import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { formatDate } from '@/lib/format-date'
import { lastNameOf, joinGuarantors, loanProgramLabel } from '@/lib/loan-doc-format'

export interface AttorneySubmissionInput {
  propertyAddress: string | null
  loanNumber: string | null
  loanType: string | null
  termMonths: number | null
  borrowerName: string | null
  coBorrowerNames: string[]
  entityName: string | null
  titleCompany: string | null
  titleContactName: string | null
  titleEmail: string | null
  titlePhone: string | null
  estimatedClosingDate: string | null
}

let cachedLogo: Buffer | null = null
function getLogoBuffer(): Buffer | null {
  if (cachedLogo) return cachedLogo
  try {
    cachedLogo = fs.readFileSync(path.join(process.cwd(), 'public', 'logo-main.png'))
    return cachedLogo
  } catch (err) {
    console.error('[attorney-submission-pdf] failed to load logo:', err)
    return null
  }
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 54,
    fontSize: 11,
    color: '#111827',
    fontFamily: 'Helvetica',
    lineHeight: 1.4,
  },
  // Header — logo centered on top, title below. Stacked instead of
  // side-by-side because the doubled logo is wider than what fits
  // alongside a fontSize-18 title within the 504pt content area.
  title: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 10,
  },
  // logo-main.png is actually 766x264 (ratio ~2.9:1), not 724x86.
  // Box matches the real ratio so contain-fit doesn't letterbox.
  // Visible size unchanged from the "doubled" request — the old
  // 400pt-wide box only showed ~138pt of actual logo.
  logo: {
    width: 138,
    height: 47.5, // 138 / 766 * 264 ≈ 47.5
    objectFit: 'contain',
    alignSelf: 'center',
  },
  brandWordmark: {
    color: '#1F5D8F',
    fontFamily: 'Helvetica-Bold',
    fontSize: 32,
    textAlign: 'center',
  },
  // Field block — one row per label/value pair.
  fieldsBlock: {
    marginTop: 36,
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 6,
  },
  fieldLabel: {
    fontFamily: 'Helvetica-Bold',
  },
  fieldValue: {
    flexShrink: 1,
  },
})

function HeaderLogo() {
  const logo = getLogoBuffer()
  if (logo) return <Image src={logo} style={styles.logo} />
  return <Text style={styles.brandWordmark}>First Equity Funding</Text>
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  )
}

export async function renderAttorneySubmissionPdf(input: AttorneySubmissionInput): Promise<Buffer> {
  const {
    propertyAddress, loanNumber, loanType, termMonths,
    borrowerName, coBorrowerNames, entityName,
    titleCompany, titleContactName, titleEmail, titlePhone,
    estimatedClosingDate,
  } = input

  const guarantors = joinGuarantors(borrowerName, ...coBorrowerNames)
  const titleContactDisplay = [titleContactName, titleCompany]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(' / ')

  const doc = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header — logo centered above the title */}
        <HeaderLogo />
        <Text style={styles.title}>Attorney Submission Summary</Text>

        <View style={styles.fieldsBlock}>
          <Field label="Subject Property:" value={propertyAddress ?? ''} />
          <Field label="Borrower Last Name:" value={lastNameOf(borrowerName)} />
          <Field label="Loan Number:" value={loanNumber ?? ''} />
          <Field label="Loan Program:" value={loanProgramLabel(loanType, termMonths)} />
          <Field label="Borrower name:" value={borrowerName ?? ''} />
          <Field label="Guarantors on loan:" value={guarantors} />
          <Field label="Guarantor #1:" value={borrowerName ?? ''} />
          <Field label="Entity name:" value={entityName ?? ''} />
          <Field label="Title contact/s:" value={titleContactDisplay} />
          <Field label="Title contact email:" value={titleEmail ?? ''} />
          <Field label="Title contact phone:" value={titlePhone ?? ''} />
          <Field
            label="Desired closing date:"
            value={estimatedClosingDate ? formatDate(estimatedClosingDate) : ''}
          />
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
