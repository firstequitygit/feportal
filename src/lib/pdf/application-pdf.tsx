import React from 'react'
import {
  Document, Page, View, Text, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, EXPERIENCE_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, UNIT_FIELDS,
  isVisible, dscrUnitCount,
  type FieldDef, type ApplicationData,
} from '@/lib/application-fields'

const NAVY = '#1F5D8F'

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, fontSize: 9, color: '#1f2937', fontFamily: 'Helvetica' },
  header: { backgroundColor: NAVY, padding: 16, borderRadius: 4, marginBottom: 14 },
  headerTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  headerSub: { fontSize: 9, marginTop: 4, color: '#dbeafe' },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 14, marginBottom: 5, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 3 },
  subTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#374151', marginTop: 8, marginBottom: 2 },
  row: { flexDirection: 'row', paddingVertical: 1.5 },
  label: { width: '48%', color: '#6b7280', paddingRight: 8 },
  value: { width: '52%' },
  empty: { color: '#9ca3af', fontStyle: 'italic' },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: '#9ca3af', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 5 },
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

function FieldRows({ fields, scope, data }: { fields: readonly FieldDef[]; scope: ApplicationData; data: ApplicationData }) {
  const rows = fields.filter(f => isVisible(f, data, scope) && !isEmptyVal(scope[f.name]))
  if (rows.length === 0) return <Text style={styles.empty}>Not provided.</Text>
  return (
    <>
      {rows.map(f => (
        <View key={f.name} style={styles.row} wrap={false}>
          <Text style={styles.label}>{f.label}</Text>
          <Text style={styles.value}>{formatValue(f, scope[f.name])}</Text>
        </View>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
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
  const propStreet = [data.property_street, data.property_city, data.property_state, data.property_zip].filter(Boolean).join(', ')

  const doc = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>First Equity Funding - Loan Application</Text>
          <Text style={styles.headerSub}>{propStreet || 'Subject property not provided'} | Submitted {submittedOn}</Text>
        </View>

        <Section title="Primary Borrower">
          <FieldRows fields={[...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]} scope={primary} data={data} />
        </Section>

        {cobs.map((cb, i) => (
          <Section key={`cb-${i}`} title={`Co-Borrower ${i + 1}`}>
            <FieldRows fields={BORROWER_FIELDS} scope={cb} data={data} />
          </Section>
        ))}

        <Section title="Deal & Property">
          <FieldRows fields={DEAL_FIELDS} scope={data} data={data} />
        </Section>

        {unitCount > 0 && (
          <Section title="Rental Units">
            {Array.from({ length: unitCount }).map((_, i) => (
              <View key={`u-${i}`}>
                <Text style={styles.subTitle}>Unit {i + 1}</Text>
                <FieldRows fields={UNIT_FIELDS} scope={(units[i] ?? {}) as ApplicationData} data={data} />
              </View>
            ))}
          </Section>
        )}

        <Section title="Experience">
          <FieldRows fields={EXPERIENCE_FIELDS} scope={data} data={data} />
        </Section>

        <Section title="Declarations">
          <FieldRows fields={DECLARATION_FIELDS} scope={data} data={data} />
          {!isEmptyVal(data.declarations_explanation) && (
            <View style={styles.row} wrap={false}>
              <Text style={styles.label}>Explanation</Text>
              <Text style={styles.value}>{String(data.declarations_explanation)}</Text>
            </View>
          )}
        </Section>

        <Section title="Government Monitoring (HMDA)">
          <FieldRows fields={HMDA_FIELDS} scope={data} data={data} />
        </Section>

        <Section title="Authorization">
          <View style={styles.row} wrap={false}>
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
