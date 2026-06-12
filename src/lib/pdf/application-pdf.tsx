import React from 'react'
import {
  Document, Page, View, Text, Image, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, EXPERIENCE_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, UNIT_FIELDS,
  isVisible, dscrUnitCount,
  type FieldDef, type ApplicationData,
} from '@/lib/application-fields'
import { FEF_LOGO } from './logo-data'

const NAVY = '#1F5D8F'
const NAVY_DARK = '#0F3A5E'
const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 40, fontSize: 9, color: INK, fontFamily: 'Helvetica' },

  // Header: the FEF color logo on the left and the document title + submitted
  // date on the right, over a navy rule.
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: NAVY,
  },
  logo: { width: 150, height: 52 },
  headerRight: { alignItems: 'flex-end' },
  headerTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: 0.5 },
  headerSub: { fontSize: 8.5, marginTop: 3, color: MUTED },

  // Summary card: the at-a-glance identifiers a reviewer needs first.
  summary: {
    marginTop: 12, backgroundColor: '#f1f5f9', borderRadius: 4,
    borderLeftWidth: 3, borderLeftColor: NAVY, paddingVertical: 9, paddingHorizontal: 12,
  },
  summaryRow: { flexDirection: 'row', marginBottom: 6 },
  summaryItem: { paddingRight: 14 },
  summaryLabel: { fontSize: 7, color: MUTED, fontFamily: 'Helvetica-Bold', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  summaryValue: { fontSize: 10, color: NAVY_DARK, fontFamily: 'Helvetica-Bold' },

  sectionTitle: {
    fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: NAVY,
    marginTop: 15, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: NAVY, paddingBottom: 3,
  },
  subTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#374151', marginTop: 8, marginBottom: 3 },

  // Two-column field grid: pairs flow into two columns to use the page width
  // and keep the document scannable and short.
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', flexDirection: 'row', paddingVertical: 2.5, paddingRight: 14 },
  cellFull: { width: '100%', flexDirection: 'row', paddingVertical: 2.5 },
  label: { width: '44%', color: MUTED, paddingRight: 8 },
  value: { width: '56%', color: INK },
  zebra: { backgroundColor: '#f8fafc' },
  empty: { color: '#9ca3af', fontStyle: 'italic', paddingVertical: 2 },

  footer: {
    position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row',
    justifyContent: 'space-between', fontSize: 7.5, color: '#9ca3af',
    borderTopWidth: 1, borderTopColor: LINE, paddingTop: 5,
  },
})

function maskSSN(v: unknown): string {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `XXX-XX-${digits.slice(-4)}` : '***'
}

function isEmptyVal(v: unknown): boolean {
  return v === undefined || v === null || v === ''
}

function formatValue(f: FieldDef, raw: unknown): string {
  if (isEmptyVal(raw)) return '-'
  if (f.type === 'ssn') return maskSSN(raw)
  if (f.type === 'yesno' || typeof raw === 'boolean') return raw === true ? 'Yes' : raw === false ? 'No' : '-'
  if (f.type === 'currency') {
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,\s]/g, ''))
    return Number.isNaN(num) ? String(raw) : `$${num.toLocaleString('en-US')}`
  }
  return String(raw)
}

function fullName(scope: ApplicationData): string {
  return [scope.first_name, scope.middle_name, scope.last_name]
    .map(v => (isEmptyVal(v) ? '' : String(v).trim()))
    .filter(Boolean)
    .join(' ')
}

function propertyAddress(data: ApplicationData): string {
  const street = [data.property_street, data.property_line_2]
    .map(v => (isEmptyVal(v) ? '' : String(v).trim())).filter(Boolean).join(', ')
  const region = [data.property_state, data.property_zip]
    .map(v => (isEmptyVal(v) ? '' : String(v).trim())).filter(Boolean).join(' ')
  const cityRegion = [data.property_city, region]
    .map(v => (isEmptyVal(v) ? '' : String(v).trim())).filter(Boolean).join(', ')
  return [street, cityRegion].filter(Boolean).join(', ')
}

/** Two-column grid of label/value pairs. Long free-text fields span full width. */
function FieldGrid({ fields, scope, data }: { fields: readonly FieldDef[]; scope: ApplicationData; data: ApplicationData }) {
  const rows = fields.filter(f => isVisible(f, data, scope) && !isEmptyVal(scope[f.name]))
  if (rows.length === 0) return <Text style={styles.empty}>Not provided.</Text>
  return (
    <View style={styles.grid}>
      {rows.map((f, i) => {
        const full = f.type === 'textarea'
        return (
          <View key={f.name} style={[full ? styles.cellFull : styles.cell, i % 4 < 2 ? styles.zebra : {}]} wrap={false}>
            <Text style={styles.label}>{f.label}</Text>
            <Text style={styles.value}>{formatValue(f, scope[f.name])}</Text>
          </View>
        )
      })}
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View wrap={false}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function SummaryItem({ label, value, width }: { label: string; value: string; width: string }) {
  return (
    <View style={[styles.summaryItem, { width }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value || '-'}</Text>
    </View>
  )
}

/** Render the full application to a PDF Buffer. SSN is masked to last 4. */
export async function renderApplicationPdf(data: ApplicationData): Promise<Buffer> {
  const primary = (data.primary as ApplicationData) ?? {}
  const cobs: ApplicationData[] = Array.isArray(data.co_borrowers) ? (data.co_borrowers as ApplicationData[]) : []
  const units: ApplicationData[] = Array.isArray(data.units) ? (data.units as ApplicationData[]) : []
  const unitCount = dscrUnitCount(data)
  const submittedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const borrowerNames = [fullName(primary), ...cobs.map(fullName)].filter(Boolean)
  const borrowerLine = borrowerNames.length ? borrowerNames.join('  •  ') : 'Not provided'
  const propertyFull = propertyAddress(data) || 'Not provided'
  const loanType = isEmptyVal(data.loan_type) ? '-' : String(data.loan_type)
  const transaction = isEmptyVal(data.purchase_or_refi) ? '-' : String(data.purchase_or_refi)

  const doc = (
    <Document
      title={`First Equity Funding - Loan Application${borrowerNames.length ? ' - ' + borrowerNames[0] : ''}`}
      author="First Equity Funding"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Image src={FEF_LOGO} style={styles.logo} />
          <View style={styles.headerRight}>
            <Text style={styles.headerTitle}>LOAN APPLICATION</Text>
            <Text style={styles.headerSub}>Submitted {submittedOn}</Text>
          </View>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <SummaryItem label="Borrower(s)" value={borrowerLine} width="100%" />
          </View>
          <View style={styles.summaryRow}>
            <SummaryItem label="Subject Property" value={propertyFull} width="100%" />
          </View>
          <View style={[styles.summaryRow, { marginBottom: 0 }]}>
            <SummaryItem label="Loan Type" value={loanType} width="34%" />
            <SummaryItem label="Transaction" value={transaction} width="33%" />
            <SummaryItem label="Submitted" value={submittedOn} width="33%" />
          </View>
        </View>

        <Section title="Primary Borrower">
          <FieldGrid fields={[...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]} scope={primary} data={data} />
        </Section>

        {cobs.map((cb, i) => (
          <Section key={`cb-${i}`} title={`Co-Borrower ${i + 1}`}>
            <FieldGrid fields={BORROWER_FIELDS} scope={cb} data={data} />
          </Section>
        ))}

        <Section title="Deal & Property">
          <FieldGrid fields={DEAL_FIELDS} scope={data} data={data} />
        </Section>

        {unitCount > 0 && (
          <Section title="Rental Units">
            {Array.from({ length: unitCount }).map((_, i) => (
              <View key={`u-${i}`} wrap={false}>
                <Text style={styles.subTitle}>Unit {i + 1}</Text>
                <FieldGrid fields={UNIT_FIELDS} scope={(units[i] ?? {}) as ApplicationData} data={data} />
              </View>
            ))}
          </Section>
        )}

        <Section title="Experience">
          <FieldGrid fields={EXPERIENCE_FIELDS} scope={data} data={data} />
        </Section>

        <Section title="Declarations">
          <FieldGrid fields={DECLARATION_FIELDS} scope={data} data={data} />
          {!isEmptyVal(data.declarations_explanation) && (
            <View style={styles.cellFull} wrap={false}>
              <Text style={styles.label}>Explanation</Text>
              <Text style={styles.value}>{String(data.declarations_explanation)}</Text>
            </View>
          )}
        </Section>

        <Section title="Government Monitoring (HMDA)">
          <FieldGrid fields={HMDA_FIELDS} scope={data} data={data} />
        </Section>

        <Section title="Authorization">
          <View style={styles.cellFull} wrap={false}>
            <Text style={styles.label}>Signature</Text>
            <Text style={styles.value}>{isEmptyVal(data.auth_signature) ? '-' : String(data.auth_signature)}</Text>
          </View>
        </Section>

        <View style={styles.footer} fixed>
          <Text>First Equity Funding - Confidential</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
