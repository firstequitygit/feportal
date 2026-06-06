'use client'

// Wide horizontally-scrolling table that mirrors Alicyn's Airtable data
// tape view. Sticky header + sticky first column so the property column
// and the column titles stay anchored as you scroll across the ~50
// columns and through thousands of rows.
//
// Features in v1:
//   - Free-text search across property / loan number / borrower / etc.
//   - Loan-type + stage + investor quick filters
//   - "Download CSV" — exports whatever's currently visible after filters
//   - Click a row's property to jump to the loan detail page
//
// Not in v1 (call them out if you want them):
//   - Per-column show/hide (use the Loan Details views feature
//     separately if you want to hide individual fields on the loan
//     page itself)
//   - Server-side pagination — the whole result set ships in one go.
//     ~2,000 rows × 50 columns renders in well under a second; the
//     bigger concern is browser memory, which is fine in modern
//     Chrome/Edge/Firefox at this size.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Download, ChevronRight, ChevronDown, Minimize2 } from 'lucide-react'
import { formatDate } from '@/lib/format-date'
import type { DataTapeRow } from '@/lib/fetch-data-tape'

interface Props {
  rows: DataTapeRow[]
  /** Path prefix for the "open loan" link — admin and UW pages route
   *  to different loan-detail surfaces. */
  loanDetailHref: (loanId: string) => string
}

type ColumnFormat = 'text' | 'currency' | 'percent' | 'percent-stored-as-pct' | 'date' | 'integer' | 'boolean' | 'stage'

interface ColumnDef {
  key: keyof DataTapeRow
  label: string
  format: ColumnFormat
  /** Wider classes for long-string columns (addresses, notes). */
  widthClass?: string
  /** Group label for the optional column-group header row. */
  group: string
}

// Source-of-truth column spec. The CSV exporter and the visible table
// both iterate this in order, so to add / remove / reorder columns
// just touch this one array.
const COLUMNS: ColumnDef[] = [
  // Identifiers
  { key: 'property_address',          label: 'Property',                 format: 'text',     group: 'ID', widthClass: 'w-72' },
  { key: 'loan_number',               label: 'Loan #',                   format: 'text',     group: 'ID' },
  { key: 'investor_loan_number',      label: 'Investor Loan #',          format: 'text',     group: 'ID' },
  { key: 'min_number',                label: 'MIN #',                    format: 'text',     group: 'ID' },
  { key: 'pipeline_stage',            label: 'Stage',                    format: 'stage',    group: 'ID' },
  { key: 'loan_status',               label: 'Status',                   format: 'text',     group: 'ID' },

  // People
  { key: 'borrower_name',             label: 'Borrower',                 format: 'text',     group: 'People', widthClass: 'w-48' },
  { key: 'loan_officer_name',         label: 'LO',                       format: 'text',     group: 'People', widthClass: 'w-44' },
  { key: 'loan_processor_name',       label: 'LP',                       format: 'text',     group: 'People', widthClass: 'w-44' },
  { key: 'underwriter_name',          label: 'UW',                       format: 'text',     group: 'People', widthClass: 'w-44' },
  { key: 'broker_name',               label: 'Broker',                   format: 'text',     group: 'People', widthClass: 'w-44' },
  { key: 'broker_company',            label: 'Broker Co.',               format: 'text',     group: 'People', widthClass: 'w-44' },

  // Loan structure
  { key: 'loan_type',                 label: 'Loan Type',                format: 'text',     group: 'Loan' },
  { key: 'loan_type_one',             label: 'Loan Purpose',             format: 'text',     group: 'Loan' },
  { key: 'loan_amount',               label: 'Loan Amount',              format: 'currency', group: 'Loan' },
  { key: 'initial_loan_amount',       label: 'Initial Loan Amt',         format: 'currency', group: 'Loan' },
  { key: 'cash_out_amount',           label: 'Cash-Out Amt',             format: 'currency', group: 'Loan' },
  { key: 'interest_rate',             label: 'Rate',                     format: 'percent-stored-as-pct', group: 'Loan' },
  { key: 'rate_type',                 label: 'Rate Type',                format: 'text',     group: 'Loan' },
  { key: 'interest_only',             label: 'Interest Only',            format: 'text',     group: 'Loan' },
  { key: 'amortization_schedule',     label: 'Amortization',             format: 'text',     group: 'Loan' },
  { key: 'term_months',               label: 'Term (mo)',                format: 'integer',  group: 'Loan' },
  { key: 'points',                    label: 'Points',                   format: 'text',     group: 'Loan' },
  { key: 'broker_points',             label: 'Broker Points',            format: 'text',     group: 'Loan' },
  { key: 'broker_ysp',                label: 'Broker YSP',               format: 'text',     group: 'Loan' },
  { key: 'prepayment_penalty',        label: 'Prepay Penalty',           format: 'text',     group: 'Loan' },
  { key: 'rate_locked_days',          label: 'Rate Locked',              format: 'text',     group: 'Loan' },
  { key: 'rate_lock_expiration_date', label: 'Rate Lock Exp.',           format: 'date',     group: 'Loan' },
  { key: 'rate_lock_extended',        label: 'Rate Lock Ext.',           format: 'text',     group: 'Loan' },

  // Dates
  { key: 'submitted_at',              label: 'Submitted',                format: 'date',     group: 'Dates' },
  { key: 'origination_date',          label: 'Closing / Origination',    format: 'date',     group: 'Dates' },
  { key: 'estimated_closing_date',    label: 'Est. Closing',             format: 'date',     group: 'Dates' },
  { key: 'first_payment_date',        label: 'First Payment',            format: 'date',     group: 'Dates' },
  { key: 'maturity_date',             label: 'Maturity',                 format: 'date',     group: 'Dates' },
  { key: 'funded_date',               label: 'Funded',                   format: 'date',     group: 'Dates' },

  // Valuation
  { key: 'purchase_price',            label: 'Purchase Price',           format: 'currency', group: 'Value' },
  { key: 'acquisition_date',          label: 'Acquired',                 format: 'date',     group: 'Value' },
  { key: 'value_as_is',               label: 'Value (As-Is)',            format: 'currency', group: 'Value' },
  { key: 'arv',                       label: 'Value (ARV)',              format: 'currency', group: 'Value' },
  { key: 'value_bpo',                 label: 'Value (BPO)',              format: 'currency', group: 'Value' },
  { key: 'ltv',                       label: 'LTV',                      format: 'percent-stored-as-pct', group: 'Value' },
  { key: 'rehab_budget',              label: 'Construction Cost',        format: 'currency', group: 'Value' },
  { key: 'construction_holdback',     label: 'Const. Holdback',          format: 'currency', group: 'Value' },

  // Property
  { key: 'property_type',             label: 'Property Type',            format: 'text',     group: 'Property' },
  { key: 'number_of_units',           label: '# Units',                  format: 'integer',  group: 'Property' },
  { key: 'square_footage',            label: 'Sq Ft',                    format: 'integer',  group: 'Property' },
  { key: 'property_state',            label: 'State',                    format: 'text',     group: 'Property' },
  { key: 'flood_zone',                label: 'Flood Zone',               format: 'text',     group: 'Property' },

  // UW flags / overview
  { key: 'urgency',                   label: 'Urgency',                  format: 'text',     group: 'UW' },
  { key: 'investor',                  label: 'Investor',                 format: 'text',     group: 'UW' },
  { key: 'cross_collateralization',   label: 'Cross Collat',             format: 'boolean',  group: 'UW' },
  { key: 'foreign_national',          label: 'Foreign National',         format: 'boolean',  group: 'UW' },
  { key: 'entity_name',               label: 'Entity',                   format: 'text',     group: 'UW', widthClass: 'w-48' },
  { key: 'exceptions',                label: 'Exceptions',               format: 'text',     group: 'UW', widthClass: 'w-64' },
  { key: 'underwriter_notes',         label: "UW Notes (Alicyn's)",      format: 'text',     group: 'UW', widthClass: 'w-72' },

  // DSCR
  { key: 'qualifying_rent',           label: 'Qualifying Rent',          format: 'currency', group: 'DSCR' },
  { key: 'annual_property_tax',       label: 'Annual Prop Tax',          format: 'currency', group: 'DSCR' },
  { key: 'annual_insurance_premium',  label: 'Annual Insurance',         format: 'currency', group: 'DSCR' },
  { key: 'annual_flood_insurance',    label: 'Annual Flood',             format: 'currency', group: 'DSCR' },
  { key: 'annual_hoa_dues',           label: 'Annual HOA',               format: 'currency', group: 'DSCR' },

  // Borrower / Credit
  { key: 'number_of_properties',      label: '# Properties',             format: 'integer',  group: 'Borrower' },
  { key: 'verified_assets',           label: 'Verified Assets',          format: 'text',     group: 'Borrower' },
  { key: 'credit_score',              label: 'Credit Score',             format: 'integer',  group: 'Borrower' },
  { key: 'credit_report_date',        label: 'Credit Pulled',            format: 'date',     group: 'Borrower' },

  // Appraisal
  { key: 'appraisal_paid_date',       label: 'Appraisal Paid',           format: 'date',     group: 'Appraisal' },
  { key: 'appraisal_received_date',   label: 'Appraisal Received',       format: 'date',     group: 'Appraisal' },
  { key: 'appraisal_effective_date',  label: 'Appraisal Effective',      format: 'date',     group: 'Appraisal' },

  // Fees
  { key: 'underwriting_fee',          label: 'UW Fee',                   format: 'currency', group: 'Fees' },
  { key: 'legal_doc_prep_fee',        label: 'Legal/Doc Prep',           format: 'currency', group: 'Fees' },
  { key: 'desk_review_fee',           label: 'Desk Review',              format: 'currency', group: 'Fees' },
  { key: 'small_balance_fee',         label: 'Small Balance',            format: 'currency', group: 'Fees' },
  { key: 'feasibility_fee',           label: 'Feasibility',              format: 'currency', group: 'Fees' },
  { key: 'additional_fees',           label: 'Additional Fees',          format: 'currency', group: 'Fees' },

  // Vendors
  { key: 'title_company',             label: 'Title',                    format: 'text',     group: 'Vendors', widthClass: 'w-48' },
  { key: 'insurance_company',         label: 'Insurance',                format: 'text',     group: 'Vendors', widthClass: 'w-48' },
  { key: 'appraisal_company',         label: 'Appraiser',                format: 'text',     group: 'Vendors', widthClass: 'w-48' },
]

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const integerFmt = new Intl.NumberFormat('en-US')

function formatCell(value: unknown, format: ColumnFormat): string {
  if (value === null || value === undefined || value === '') return ''
  switch (format) {
    case 'currency':
      return typeof value === 'number' ? currencyFmt.format(value) : String(value)
    case 'integer':
      return typeof value === 'number' ? integerFmt.format(value) : String(value)
    case 'percent':
      return typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : String(value)
    case 'percent-stored-as-pct':
      // Interest rate + LTV are stored as percent already (7.75 = 7.75%).
      // Hard-money rates can be sub-1 if Pipedrive synced a fraction —
      // matches the heuristic in format-interest-rate.ts.
      if (typeof value !== 'number') return String(value)
      return value < 1 ? `${(value * 100).toFixed(3)}%` : `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`
    case 'date':
      return formatDate(typeof value === 'string' ? value : null)
    case 'boolean':
      return value === true ? 'Yes' : value === false ? 'No' : ''
    case 'stage':
      return String(value)
    default:
      return String(value)
  }
}

function stageColor(stage: string | null): string {
  switch (stage) {
    case 'Processing':              return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'Pre-Underwriting':        return 'bg-indigo-50 text-indigo-700 border-indigo-200'
    case 'Underwriting':            return 'bg-purple-50 text-purple-700 border-purple-200'
    case 'Conditionally Approved':  return 'bg-teal-50 text-teal-700 border-teal-200'
    case 'Approved':                return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'Closed':                  return 'bg-gray-100 text-gray-600 border-gray-200'
    default:                        return 'bg-gray-50 text-gray-700 border-gray-200'
  }
}

export function DataTape({ rows, loanDetailHref }: Props) {
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [loanTypeFilter, setLoanTypeFilter] = useState<string>('all')
  const [investorFilter, setInvestorFilter] = useState<string>('all')
  // Rows are single-line + truncated by default — long property
  // addresses / borrower names / UW notes used to wrap and balloon
  // row height. Click the chevron in the property cell to flip a
  // single row into wrap mode for full content.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function toggleExpand(loanId: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(loanId)) next.delete(loanId)
      else next.add(loanId)
      return next
    })
  }

  function collapseAll() {
    setExpandedIds(new Set())
  }

  // Derive the dropdown option sets from the data — keeps the UI from
  // showing a filter for a stage / investor that no loan currently has.
  const stages = useMemo(
    () => Array.from(new Set(rows.map(r => r.pipeline_stage).filter((s): s is string => !!s))).sort(),
    [rows],
  )
  const loanTypes = useMemo(
    () => Array.from(new Set(rows.map(r => r.loan_type).filter((s): s is string => !!s))).sort(),
    [rows],
  )
  const investors = useMemo(
    () => Array.from(new Set(rows.map(r => r.investor).filter((s): s is string => !!s))).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (stageFilter !== 'all' && r.pipeline_stage !== stageFilter) return false
      if (loanTypeFilter !== 'all' && r.loan_type !== loanTypeFilter) return false
      if (investorFilter !== 'all' && r.investor !== investorFilter) return false
      if (!q) return true
      // Cheap multi-field match — anything in this little bundle counts.
      const haystack = [
        r.property_address, r.loan_number, r.investor_loan_number, r.min_number,
        r.borrower_name, r.broker_name, r.broker_company, r.entity_name,
        r.loan_officer_name, r.loan_processor_name, r.underwriter_name,
        r.investor, r.exceptions, r.underwriter_notes,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, search, stageFilter, loanTypeFilter, investorFilter])

  function downloadCsv() {
    const header = COLUMNS.map(c => c.label).join(',')
    const csvRows = filtered.map(row =>
      COLUMNS.map(c => csvEscape(formatCell(row[c.key], c.format))).join(',')
    )
    const csv = [header, ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `data-tape-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Toolbar — search, filters, download. Sticky-positioned so it
          stays visible while the user scrolls the table beneath it. */}
      <div className="sticky top-0 z-30 bg-gray-50/80 backdrop-blur-sm border border-gray-200 rounded-md p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search property, loan #, borrower, investor…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="text-sm px-2 py-1.5 border border-gray-300 rounded bg-white"
        >
          <option value="all">All stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={loanTypeFilter}
          onChange={e => setLoanTypeFilter(e.target.value)}
          className="text-sm px-2 py-1.5 border border-gray-300 rounded bg-white"
        >
          <option value="all">All loan types</option>
          {loanTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={investorFilter}
          onChange={e => setInvestorFilter(e.target.value)}
          className="text-sm px-2 py-1.5 border border-gray-300 rounded bg-white"
        >
          <option value="all">All investors</option>
          {investors.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-xs text-gray-500 whitespace-nowrap">
          <strong className="text-gray-900">{filtered.length}</strong> of {rows.length} loans
        </span>
        {expandedIds.size > 0 && (
          <button
            type="button"
            onClick={collapseAll}
            title="Collapse every expanded row back to single-line"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            Collapse {expandedIds.size}
          </button>
        )}
        <button
          type="button"
          onClick={downloadCsv}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          Download CSV
        </button>
      </div>

      {/* Table — wrapped in a horizontal scroller. The first column is
          sticky-left and the header row is sticky-top so identifiers
          stay visible while scrolling either axis. */}
      <div className="border border-gray-200 rounded-md bg-white overflow-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <th
                  key={c.key}
                  className={`sticky top-0 z-20 bg-gray-100 border-b border-gray-200 px-2.5 py-2 text-left font-semibold text-gray-700 whitespace-nowrap ${
                    i === 0 ? 'sticky-left-col-header' : ''
                  } ${c.widthClass ?? ''}`}
                  style={i === 0 ? { left: 0, zIndex: 30 } : undefined}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  {rows.length === 0
                    ? 'No active loans yet.'
                    : 'No loans match the current filters.'}
                </td>
              </tr>
            ) : (
              filtered.map(row => {
                const isExpanded = expandedIds.has(row.id)
                // truncate gives overflow-hidden + text-overflow-ellipsis +
                // whitespace-nowrap in one class; flip to wrap when the row
                // is expanded.
                const wrapClass = isExpanded ? 'whitespace-normal break-words' : 'truncate'
                // Fallback max-width for unwidth'd columns so truncate has
                // something to clip against. Columns with widthClass keep
                // their own width.
                const defaultWidthClass = 'max-w-[180px]'
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-gray-50 border-b border-gray-100 ${isExpanded ? 'bg-blue-50/40' : ''}`}
                  >
                    {COLUMNS.map((c, i) => {
                      const value = row[c.key]
                      const text = formatCell(value, c.format)
                      const tdClasses = 'px-2.5 py-1.5 align-top'

                      if (i === 0) {
                        // Sticky property column — also holds the expand
                        // toggle so it's always visible (sticky-left =
                        // anchored even when scrolled horizontally).
                        return (
                          <td
                            key={c.key}
                            className={`${tdClasses} sticky left-0 bg-white hover:bg-gray-50 z-10 border-r border-gray-200`}
                          >
                            <div className="flex items-start gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleExpand(row.id)}
                                className="text-gray-400 hover:text-gray-700 mt-0.5 shrink-0"
                                aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                                title={isExpanded ? 'Collapse row' : 'Expand row to see full content'}
                              >
                                {isExpanded
                                  ? <ChevronDown className="w-3.5 h-3.5" />
                                  : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                              <div className={`${c.widthClass ?? defaultWidthClass} ${wrapClass}`} title={text}>
                                <Link
                                  href={loanDetailHref(row.id)}
                                  className="text-primary hover:underline font-medium"
                                >
                                  {text || '(no address)'}
                                </Link>
                              </div>
                            </div>
                          </td>
                        )
                      }

                      if (c.format === 'stage' && value) {
                        // Pills don't need wrap logic — they're tiny.
                        return (
                          <td key={c.key} className={tdClasses}>
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ${stageColor(String(value))}`}>
                              {text}
                            </span>
                          </td>
                        )
                      }

                      if (c.format === 'boolean') {
                        if (value === null || value === undefined) {
                          return <td key={c.key} className={`${tdClasses} text-gray-300`}>—</td>
                        }
                        const cls = value ? 'text-emerald-700' : 'text-gray-500'
                        return <td key={c.key} className={`${tdClasses} ${cls}`}>{text}</td>
                      }

                      if (!text) {
                        return <td key={c.key} className={`${tdClasses} text-gray-300`}>—</td>
                      }

                      // Standard text/currency/date cell — single-line with
                      // ellipsis when collapsed, wraps when expanded.
                      return (
                        <td key={c.key} className={tdClasses}>
                          <div
                            className={`${c.widthClass ?? defaultWidthClass} ${wrapClass}`}
                            title={text}
                          >
                            {text}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Spreadsheet-safe CSV cell — quotes the value if it contains a comma,
// newline, or embedded quote, and doubles embedded quotes per RFC 4180.
function csvEscape(s: string): string {
  if (s === '') return ''
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
