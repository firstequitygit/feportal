// React-PDF Conditions List — a downloadable PDF of a loan's
// conditions: a flat list ordered by status (complete first,
// action-needed last), each showing title, details, status, and the
// internal staff notes. Reached via the "Conditions List" button in
// the Conditions section header.

import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { Condition, ConditionStatus } from '@/lib/types'

export interface ConditionNoteInput {
  id: string
  content: string
  created_by: string
  created_at: string
}

export interface ConditionsReportInput {
  loanName: string
  loanNumber: string | null
  propertyAddress: string | null
  conditions: Condition[]
  notesByCondition: Record<string, ConditionNoteInput[]>
  /** Include the internal staff notes under each condition. When false,
   *  the report is the clean title/details/status list only. */
  includeNotes?: boolean
}

// Display order: complete items first, action-needed last.
const STATUS_RANK: Record<ConditionStatus, number> = {
  'Satisfied':    0,
  'Waived':       1,
  'Received':     2,
  'Under Review': 3,
  'Outstanding':  4,
  'Rejected':     5,
}

function statusColor(status: ConditionStatus): string {
  switch (status) {
    case 'Satisfied':    return '#15803d'
    case 'Waived':       return '#6b7280'
    case 'Received':     return '#a16207'
    case 'Under Review': return '#1d4ed8'
    case 'Rejected':     return '#b91c1c'
    case 'Outstanding':  return '#dc2626'
    default:             return '#374151'
  }
}

function formatDateTime(val: string): string {
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

let cachedLogo: Buffer | null = null
function getLogoBuffer(): Buffer | null {
  if (cachedLogo) return cachedLogo
  try {
    cachedLogo = fs.readFileSync(path.join(process.cwd(), 'public', 'logo-main.png'))
    return cachedLogo
  } catch (err) {
    console.error('[conditions-report-pdf] failed to load logo:', err)
    return null
  }
}

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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  logo: {
    width: 83,
    height: 28.6, // 83 / 766 * 264 ≈ 28.6
    objectFit: 'contain',
  },
  brandWordmark: {
    color: '#1F5D8F',
    fontFamily: 'Helvetica-Bold',
    fontSize: 18,
  },
  printedOn: {
    fontSize: 8,
    color: '#6b7280',
  },
  title: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    letterSpacing: 0.5,
    marginTop: 14,
  },
  loanName: {
    fontFamily: 'Helvetica-Bold',
    marginTop: 6,
  },
  loanSub: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 1,
  },
  // One condition block.
  condition: {
    marginTop: 12,
  },
  conditionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  conditionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    flex: 1,
    paddingRight: 8,
  },
  status: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
  },
  description: {
    fontSize: 9,
    color: '#4b5563',
    marginTop: 2,
  },
  rejection: {
    fontSize: 9,
    color: '#b91c1c',
    marginTop: 2,
  },
  notesHeading: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#9ca3af',
    letterSpacing: 0.5,
    marginTop: 4,
    marginLeft: 12,
  },
  noteItem: {
    fontSize: 8.5,
    color: '#374151',
    marginTop: 1,
    marginLeft: 18,
  },
  noteMeta: {
    color: '#9ca3af',
  },
  empty: {
    marginTop: 24,
    color: '#6b7280',
  },
})

function HeaderLogo() {
  const logo = getLogoBuffer()
  if (logo) return <Image src={logo} style={styles.logo} />
  return <Text style={styles.brandWordmark}>First Equity Funding</Text>
}

export async function renderConditionsReportPdf(input: ConditionsReportInput): Promise<Buffer> {
  const { loanName, loanNumber, propertyAddress, conditions, notesByCondition, includeNotes = true } = input

  const sorted = [...conditions].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
  )
  const outstanding = conditions.filter(
    c => c.status === 'Outstanding' || c.status === 'Rejected',
  ).length
  const printedOn = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  const doc = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <HeaderLogo />
          <Text style={styles.printedOn}>Printed {printedOn}</Text>
        </View>

        <Text style={styles.title}>LOAN CONDITIONS</Text>
        <Text style={styles.loanName}>{loanName}</Text>
        {propertyAddress ? <Text style={styles.loanSub}>{propertyAddress}</Text> : null}
        <Text style={styles.loanSub}>
          {loanNumber ? `Loan #${loanNumber}` : 'No loan number'}
          {'  ·  '}{conditions.length} condition{conditions.length !== 1 ? 's' : ''}
          {'  ·  '}{outstanding} outstanding
        </Text>

        {sorted.length === 0 ? (
          <Text style={styles.empty}>No conditions on this loan.</Text>
        ) : (
          sorted.map(condition => {
            const notes = includeNotes ? (notesByCondition[condition.id] ?? []) : []
            return (
              <View key={condition.id} style={styles.condition} wrap={false}>
                <View style={styles.conditionTitleRow}>
                  <Text style={styles.conditionTitle}>{condition.title}</Text>
                  <Text style={[styles.status, { color: statusColor(condition.status) }]}>
                    {condition.status}
                  </Text>
                </View>
                {condition.description ? (
                  <Text style={styles.description}>{condition.description}</Text>
                ) : null}
                {condition.status === 'Rejected' && condition.rejection_reason ? (
                  <Text style={styles.rejection}>Rejected: {condition.rejection_reason}</Text>
                ) : null}
                {notes.length > 0 ? (
                  <>
                    <Text style={styles.notesHeading}>STAFF NOTES</Text>
                    {notes.map(n => (
                      <Text key={n.id} style={styles.noteItem}>
                        {'• '}{n.content}
                        <Text style={styles.noteMeta}>
                          {'  — '}{n.created_by}{n.created_at ? `, ${formatDateTime(n.created_at)}` : ''}
                        </Text>
                      </Text>
                    ))}
                  </>
                ) : null}
              </View>
            )
          })
        )}
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
