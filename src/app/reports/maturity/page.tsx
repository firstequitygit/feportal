// Loan Maturity report — surfaces every active loan with a maturity_date,
// bucketed by how soon it matures. Mirrors the same auth + scoping rules
// as the rest of /reports — admins see the whole book, LO/LP/UW see only
// their own loans. Closed loans are excluded since they no longer mature
// in any operational sense.

import Link from 'next/link'
import { PortalShell } from '@/components/portal-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/lib/supabase/admin'
import { getReportContext, roleLabel, loanDetailHref } from '@/lib/reports/auth'
import { CsvDownloadButton } from '@/components/reports/csv-download-button'
import { ArrowLeft } from 'lucide-react'

function formatCurrency(val: number | null): string {
  if (val === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}

// Calendar-day diff in UTC. Positive = future, negative = past.
function daysFromToday(iso: string | null, todayMs: number): number | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Math.round((target - todayMs) / 86_400_000)
}

interface LoanRow {
  id: string
  property_address: string | null
  loan_amount: number | null
  maturity_date: string | null
  pipeline_stage: string | null
  loan_status: string | null
  borrowers: { full_name: string | null } | null
  loan_officers: { full_name: string | null } | null
}

// Buckets from soonest to latest. Rows fall into the first matching
// bucket. "No maturity date set" gets its own group at the bottom.
const BUCKETS: Array<{ key: string; label: string; tone: 'danger' | 'warn' | 'neutral' | 'ok'; match: (d: number | null) => boolean }> = [
  { key: 'overdue',  label: 'Overdue',             tone: 'danger',  match: d => d !== null && d < 0 },
  { key: 'today',    label: 'Today',               tone: 'danger',  match: d => d === 0 },
  { key: 'd5',       label: 'Next 5 days',         tone: 'danger',  match: d => d !== null && d >= 1 && d <= 5 },
  { key: 'd15',      label: '6 — 15 days',         tone: 'warn',    match: d => d !== null && d >= 6 && d <= 15 },
  { key: 'd45',      label: '16 — 45 days',        tone: 'warn',    match: d => d !== null && d >= 16 && d <= 45 },
  { key: 'd90',      label: '46 — 90 days',        tone: 'neutral', match: d => d !== null && d >= 46 && d <= 90 },
  { key: 'd180',     label: '91 — 180 days',       tone: 'neutral', match: d => d !== null && d >= 91 && d <= 180 },
  { key: 'beyond',   label: 'More than 180 days',  tone: 'ok',      match: d => d !== null && d > 180 },
  { key: 'no_date',  label: 'No maturity date',    tone: 'neutral', match: d => d === null },
]

function toneClass(tone: 'danger' | 'warn' | 'neutral' | 'ok'): string {
  switch (tone) {
    case 'danger':  return 'bg-red-50 text-red-700'
    case 'warn':    return 'bg-amber-50 text-amber-700'
    case 'neutral': return 'bg-gray-100 text-gray-600'
    case 'ok':      return 'bg-green-50 text-green-700'
  }
}

export default async function MaturityReportPage() {
  const ctx = await getReportContext()
  const adminClient = createAdminClient()

  // Scoped active-loans pull. We include all non-archived, non-closed
  // loans regardless of loan_status (so On-Hold loans still show up —
  // their maturity is still operationally relevant).
  let q = adminClient
    .from('loans')
    .select('id, property_address, loan_amount, maturity_date, pipeline_stage, loan_status, borrowers!borrower_id(full_name), loan_officers!loan_officer_id(full_name)')
    .eq('archived', false)
    .neq('pipeline_stage', 'Closed')
    .order('maturity_date', { ascending: true, nullsFirst: false })
  if (ctx.loanScopeColumn && ctx.loanScopeId) {
    q = q.eq(ctx.loanScopeColumn, ctx.loanScopeId)
  }

  // Paginate — the active pipeline is well under 1000 today but keep
  // the paging loop so this scales.
  const loans: LoanRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await q.range(from, from + 999)
    if (error || !data) break
    loans.push(...(data as unknown as LoanRow[]))
    if (data.length < 1000) break
    from += 1000
  }

  // Stable "today" in UTC — same wire format as the stored YYYY-MM-DD.
  const now = new Date()
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  // Decorate each row with daysUntil so we don't recompute per render.
  const decorated = loans.map(l => ({
    ...l,
    daysUntil: daysFromToday(l.maturity_date, todayMs),
  }))

  // Bucket. First matching wins; "no_date" catches the rest.
  const bucketMap = new Map<string, typeof decorated>()
  for (const b of BUCKETS) bucketMap.set(b.key, [])
  for (const row of decorated) {
    for (const b of BUCKETS) {
      if (b.match(row.daysUntil)) {
        bucketMap.get(b.key)!.push(row)
        break
      }
    }
  }

  const totalCount = decorated.length
  const totalVolume = decorated.reduce((s, r) => s + (r.loan_amount ?? 0), 0)
  const urgentCount =
    (bucketMap.get('overdue')?.length ?? 0) +
    (bucketMap.get('today')?.length ?? 0) +
    (bucketMap.get('d5')?.length ?? 0) +
    (bucketMap.get('d15')?.length ?? 0) +
    (bucketMap.get('d45')?.length ?? 0)

  // CSV — one row per loan, ordered the same way the page renders.
  const csvHeaders = ['Bucket', 'Days Until', 'Maturity Date', 'Property', 'Borrower', 'Loan Officer', 'Stage', 'Status', 'Loan Amount']
  const csvRows: (string | number)[][] = []
  for (const b of BUCKETS) {
    const rows = bucketMap.get(b.key) ?? []
    for (const r of rows) {
      csvRows.push([
        b.label,
        r.daysUntil ?? '',
        r.maturity_date ?? '',
        r.property_address ?? '',
        r.borrowers?.full_name ?? '',
        r.loan_officers?.full_name ?? '',
        r.pipeline_stage ?? '',
        r.loan_status ?? 'active',
        r.loan_amount ?? 0,
      ])
    }
  }
  csvRows.push(['Total', '', '', '', '', '', '', '', Math.round(totalVolume)])

  return (
    <PortalShell
      userName={ctx.userName}
      userRole={roleLabel(ctx.role)}
      dashboardHref={ctx.dashboardHref}
      variant={ctx.shellVariant}
      isSuperAdmin={ctx.isSuperAdmin}
    >
      <Link href="/reports" className="flex items-center gap-1.5 text-sm text-primary hover:opacity-80 mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Reports
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Loan Maturity</h2>
          <p className="text-sm text-gray-500 mt-1">
            Active loans bucketed by how soon they mature · {totalCount} loan{totalCount === 1 ? '' : 's'} · {formatCurrency(totalVolume)} total volume
            {urgentCount > 0 && <> · <span className="font-medium text-red-700">{urgentCount} maturing within 45 days</span></>}
            {ctx.role !== 'admin' && ' · scoped to your loans'}
          </p>
        </div>
        <CsvDownloadButton
          fileName="loan-maturity"
          label="Download CSV"
          headers={csvHeaders}
          rows={csvRows}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Maturity Buckets</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                <th className="pb-2 font-medium">Bucket</th>
                <th className="pb-2 font-medium text-right">Loans</th>
                <th className="pb-2 font-medium text-right">Volume</th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map(b => {
                const rows = bucketMap.get(b.key) ?? []
                if (rows.length === 0) return null
                const volume = rows.reduce((s, r) => s + (r.loan_amount ?? 0), 0)
                return (
                  <tr key={b.key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${toneClass(b.tone)}`}>{b.label}</span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{rows.length}</td>
                    <td className="py-2.5 text-right tabular-nums text-gray-700">{formatCurrency(volume)}</td>
                  </tr>
                )
              })}
              <tr className="font-semibold">
                <td className="pt-3">Total</td>
                <td className="pt-3 text-right tabular-nums">{totalCount}</td>
                <td className="pt-3 text-right tabular-nums">{formatCurrency(totalVolume)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Loans by Maturity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {totalCount === 0 ? (
            <p className="text-sm text-gray-500 italic py-4 text-center">No active loans in scope.</p>
          ) : (
            BUCKETS.filter(b => (bucketMap.get(b.key) ?? []).length > 0).map((b, idx) => {
              const rows = bucketMap.get(b.key) ?? []
              return (
                <details
                  key={b.key}
                  // Default-open the three soonest buckets so the urgent
                  // stuff is visible without an extra click.
                  {...(idx < 3 ? { open: true } : {})}
                  className="border border-gray-200 rounded-lg overflow-hidden group"
                >
                  <summary className="cursor-pointer list-none px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between gap-4">
                    <div className="flex items-baseline gap-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${toneClass(b.tone)}`}>{b.label}</span>
                      <span className="text-xs text-gray-500">{rows.length} loan{rows.length === 1 ? '' : 's'}</span>
                    </div>
                    <span className="text-xs text-gray-400 group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase bg-white">
                        <th className="px-4 py-2 font-medium">Maturity</th>
                        <th className="px-4 py-2 font-medium">Days</th>
                        <th className="px-4 py-2 font-medium">Property</th>
                        <th className="px-4 py-2 font-medium">Borrower</th>
                        <th className="px-4 py-2 font-medium">Loan Officer</th>
                        <th className="px-4 py-2 font-medium">Stage</th>
                        <th className="px-4 py-2 font-medium text-right">Loan Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const onHold = r.loan_status === 'on_hold'
                        const days = r.daysUntil
                        const daysLabel =
                          days === null ? '—' :
                          days < 0 ? `${Math.abs(days)}d overdue` :
                          days === 0 ? 'today' :
                          `${days}d`
                        return (
                          <tr key={r.id} className="border-b border-gray-100 last:border-b-0">
                            <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{formatDate(r.maturity_date)}</td>
                            <td className="px-4 py-2 text-gray-700 whitespace-nowrap tabular-nums">{daysLabel}</td>
                            <td className="px-4 py-2 font-medium text-gray-900">
                              <Link href={loanDetailHref(ctx.role, r.id)} className="hover:text-primary">
                                {r.property_address ?? '—'}
                              </Link>
                              {onHold && (
                                <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">On Hold</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-gray-700">{r.borrowers?.full_name ?? '—'}</td>
                            <td className="px-4 py-2 text-gray-700">{r.loan_officers?.full_name ?? '—'}</td>
                            <td className="px-4 py-2 text-gray-700">{r.pipeline_stage ?? '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                              {formatCurrency(r.loan_amount)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </details>
              )
            })
          )}
        </CardContent>
      </Card>
    </PortalShell>
  )
}
