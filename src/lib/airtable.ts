// Bidirectional "fill blanks only" sync between portal Loan Details and the
// First Equity Reports Airtable base (Deals table + linked Title/Insurance/
// Appraisers tables).
//
// Sync model — Model B per user direction:
//   - Airtable has value, portal empty   → pull Airtable into portal
//   - Airtable empty,    portal has value → push portal into Airtable
//   - Both have values   → no-op (preserve both)
//   - Both empty         → no-op
//
// Match key: Pipedrive Deal ID. Loans without a matching Airtable row are
// skipped (we do NOT create Deal rows from the portal).
//
// Auth: AIRTABLE_TOKEN env var (Personal Access Token with
//       data.records:read + data.records:write + schema.bases:read).

import { createAdminClient } from '@/lib/supabase/admin'
import {
  AIRTABLE_BASE_ID,
  AIRTABLE_DEALS_TABLE_ID,
  AIRTABLE_DEAL_ID_FIELD,
  FIELD_MAP,
  airtableFieldsToRead,
  isEmptyValue,
  portalLoanDetailsColumns,
  portalLoansColumns,
  type ScalarMapping,
  type VendorMapping,
} from '@/lib/airtable-field-map'

// ============================================================
// Low-level fetch with retry/backoff
// ============================================================

const AIRTABLE_API = 'https://api.airtable.com/v0'

async function airtable<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.AIRTABLE_TOKEN
  if (!token) throw new Error('AIRTABLE_TOKEN not set')
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${AIRTABLE_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Airtable ${res.status} on ${path}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }
  throw new Error(`Airtable ${path}: exceeded retry limit (rate limited)`)
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

// ============================================================
// Look up the Deal record by Pipedrive Deal ID
// ============================================================

async function findDealByPipedriveId(pipedriveDealId: string): Promise<AirtableRecord | null> {
  const escaped = pipedriveDealId.replace(/"/g, '\\"')
  const url = `/${AIRTABLE_BASE_ID}/${AIRTABLE_DEALS_TABLE_ID}?` + new URLSearchParams({
    filterByFormula: `{${AIRTABLE_DEAL_ID_FIELD}} = "${escaped}"`,
    maxRecords: '1',
  }).toString()
  const res = await airtable<{ records: AirtableRecord[] }>(url)
  return res.records[0] ?? null
}

// ============================================================
// Vendor row helpers
// ============================================================

/** In-process cache for vendor lookups across loans in a single batch run. */
const vendorRecordCache = new Map<string, AirtableRecord>()

async function fetchVendorRecord(tableId: string, recordId: string): Promise<AirtableRecord> {
  const cacheKey = `${tableId}::${recordId}`
  const cached = vendorRecordCache.get(cacheKey)
  if (cached) return cached
  const res = await airtable<AirtableRecord>(`/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`)
  vendorRecordCache.set(cacheKey, res)
  return res
}

async function findVendorByCompany(tableId: string, companyField: string, companyName: string): Promise<AirtableRecord | null> {
  const escaped = companyName.replace(/"/g, '\\"').toLowerCase()
  const url = `/${AIRTABLE_BASE_ID}/${tableId}?` + new URLSearchParams({
    filterByFormula: `LOWER({${companyField}}) = "${escaped}"`,
    maxRecords: '1',
  }).toString()
  const res = await airtable<{ records: AirtableRecord[] }>(url)
  return res.records[0] ?? null
}

async function createVendor(tableId: string, fields: Record<string, unknown>): Promise<AirtableRecord> {
  const res = await airtable<AirtableRecord>(`/${AIRTABLE_BASE_ID}/${tableId}`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  })
  return res
}

async function patchVendor(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
  await airtable(`/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  })
}

// ============================================================
// Sync one loan
// ============================================================

export interface FieldDelta {
  field: string                 // human-readable identifier ("airtable: Loan Number" or "portal: title_email")
  direction: 'push' | 'pull'    // push = portal→Airtable; pull = Airtable→portal
  oldValue: unknown
  newValue: unknown
}

export interface SyncResult {
  loanId: string
  status: 'reconciled' | 'skipped-no-deal-id' | 'skipped-no-airtable-row' | 'error'
  airtableRecordId?: string
  pushedToAirtable: number      // number of Airtable fields filled in
  pulledToPortal: number        // number of portal columns filled in
  deltas?: FieldDelta[]
  error?: string
}

export async function syncLoanToAirtable(loanId: string, opts: { collectDeltas?: boolean } = {}): Promise<SyncResult> {
  const supa = createAdminClient()
  const collectDeltas = opts.collectDeltas ?? false

  // 1. Load portal data
  const { data: loanRow, error: loanErr } = await supa
    .from('loans')
    .select(portalLoansColumns().join(','))
    .eq('id', loanId)
    .single()
  if (loanErr || !loanRow) {
    return { loanId, status: 'error', pushedToAirtable: 0, pulledToPortal: 0, error: loanErr?.message ?? 'loan not found' }
  }
  const loan = loanRow as unknown as Record<string, unknown>
  const dealId = loan.pipedrive_deal_id
  if (!dealId || typeof dealId !== 'string') {
    return { loanId, status: 'skipped-no-deal-id', pushedToAirtable: 0, pulledToPortal: 0 }
  }

  const { data: detail } = await supa
    .from('loan_details')
    .select(portalLoanDetailsColumns().join(','))
    .eq('loan_id', loanId)
    .maybeSingle()
  const detailRow = (detail ?? null) as Record<string, unknown> | null

  // 2. Find Airtable Deal record (full fields)
  const dealRecord = await findDealByPipedriveId(dealId)
  if (!dealRecord) {
    return { loanId, status: 'skipped-no-airtable-row', pushedToAirtable: 0, pulledToPortal: 0 }
  }

  const airtableFields = dealRecord.fields
  const airtablePatch: Record<string, unknown> = {}
  const portalLoanPatch: Record<string, unknown> = {}
  const portalDetailPatch: Record<string, unknown> = {}
  const deltas: FieldDelta[] = []

  // 3. Reconcile each scalar mapping
  for (const m of FIELD_MAP) {
    if (m.kind === 'scalar') reconcileScalar(m, loan, detailRow, airtableFields, airtablePatch, portalLoanPatch, portalDetailPatch, deltas, collectDeltas)
  }

  // 4. Reconcile each vendor mapping (linked-table)
  for (const m of FIELD_MAP) {
    if (m.kind !== 'vendor') continue
    await reconcileVendor(m, detailRow, airtableFields, airtablePatch, portalDetailPatch, deltas, collectDeltas)
  }

  // 5. Apply Airtable changes (PATCH the Deal — typecast lets Airtable coerce
  //    text into enum choices when values match).
  let pushedToAirtable = 0
  if (Object.keys(airtablePatch).length > 0) {
    await airtable(`/${AIRTABLE_BASE_ID}/${AIRTABLE_DEALS_TABLE_ID}/${dealRecord.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: airtablePatch, typecast: true }),
    })
    pushedToAirtable = Object.keys(airtablePatch).length
  }

  // 6. Apply portal changes
  let pulledToPortal = 0
  if (Object.keys(portalLoanPatch).length > 0) {
    const { error } = await supa.from('loans').update(portalLoanPatch).eq('id', loanId)
    if (error) throw new Error(`portal loans update failed: ${error.message}`)
    pulledToPortal += Object.keys(portalLoanPatch).length
  }
  if (Object.keys(portalDetailPatch).length > 0) {
    // upsert in case loan_details row doesn't exist yet
    const { error } = await supa
      .from('loan_details')
      .upsert(
        { loan_id: loanId, ...portalDetailPatch, updated_at: new Date().toISOString() },
        { onConflict: 'loan_id' },
      )
    if (error) throw new Error(`portal loan_details upsert failed: ${error.message}`)
    pulledToPortal += Object.keys(portalDetailPatch).length
  }

  return {
    loanId,
    status: 'reconciled',
    airtableRecordId: dealRecord.id,
    pushedToAirtable,
    pulledToPortal,
    ...(collectDeltas ? { deltas } : {}),
  }
}

// ============================================================
// Reconcile one scalar field
// ============================================================

function reconcileScalar(
  m: ScalarMapping,
  loan: Record<string, unknown>,
  detail: Record<string, unknown> | null,
  airtableFields: Record<string, unknown>,
  airtablePatch: Record<string, unknown>,
  portalLoanPatch: Record<string, unknown>,
  portalDetailPatch: Record<string, unknown>,
  deltas: FieldDelta[],
  collectDeltas: boolean,
) {
  const src = m.portalTable === 'loans' ? loan : (detail ?? {})
  const portalValue = src[m.portalCol]
  const airtableValue = airtableFields[m.airtableField]

  const portalEmpty = isEmptyValue(portalValue)
  const airtableEmpty = isEmptyValue(airtableValue)

  // Both empty or both populated → skip
  if (portalEmpty === airtableEmpty) return

  if (airtableEmpty && !portalEmpty) {
    // Push portal → Airtable
    const v = m.toAirtable ? m.toAirtable(portalValue) : portalValue
    if (v === undefined) return
    airtablePatch[m.airtableField] = v
    if (collectDeltas) {
      deltas.push({ field: `airtable: ${m.airtableField}`, direction: 'push', oldValue: airtableValue, newValue: v })
    }
  } else if (!airtableEmpty && portalEmpty) {
    // Pull Airtable → portal
    const v = m.toPortal ? m.toPortal(airtableValue) : airtableValue
    if (v === undefined) return
    if (m.portalTable === 'loans') portalLoanPatch[m.portalCol] = v
    else portalDetailPatch[m.portalCol] = v
    if (collectDeltas) {
      deltas.push({ field: `portal: ${m.portalCol}`, direction: 'pull', oldValue: portalValue, newValue: v })
    }
  }
}

// ============================================================
// Reconcile one vendor mapping (linked Title/Insurance/Appraiser)
// ============================================================

async function reconcileVendor(
  m: VendorMapping,
  detail: Record<string, unknown> | null,
  airtableFields: Record<string, unknown>,
  airtablePatch: Record<string, unknown>,
  portalDetailPatch: Record<string, unknown>,
  deltas: FieldDelta[],
  collectDeltas: boolean,
) {
  // Portal-side trio
  const detailSrc = detail ?? {}
  const portalCompany = pickString(detailSrc[m.portalCompanyCol])
  const portalEmail   = m.portalEmailCol ? pickString(detailSrc[m.portalEmailCol]) : null
  const portalPhone   = m.portalPhoneCol ? pickString(detailSrc[m.portalPhoneCol]) : null

  // Airtable-side: the Deal's link field (array of record IDs)
  const linkRaw = airtableFields[m.airtableLinkField]
  const linkedIds = Array.isArray(linkRaw) ? linkRaw.filter((x): x is string => typeof x === 'string') : []
  const airtableEmpty = linkedIds.length === 0

  if (airtableEmpty && !portalCompany) return  // nothing to do
  if (!airtableEmpty) {
    // Airtable has a linked vendor → pull its Company/Email/Phone into portal
    // for any portal column currently empty. Do NOT modify the vendor row
    // (that would feel like overwriting Airtable from portal data).
    const linkedVendor = await fetchVendorRecord(m.vendorTableId, linkedIds[0])
    const v = linkedVendor.fields
    const vendorCompany = pickString(v[m.vendorCompanyField])
    const vendorEmail = m.vendorEmailField ? pickString(v[m.vendorEmailField]) : null
    const vendorPhone = m.vendorPhoneField ? pickString(v[m.vendorPhoneField]) : null

    pullIfEmpty(detailSrc, m.portalCompanyCol, vendorCompany, portalDetailPatch, deltas, collectDeltas)
    if (m.portalEmailCol) pullIfEmpty(detailSrc, m.portalEmailCol, vendorEmail, portalDetailPatch, deltas, collectDeltas)
    if (m.portalPhoneCol) pullIfEmpty(detailSrc, m.portalPhoneCol, vendorPhone, portalDetailPatch, deltas, collectDeltas)
    return
  }

  // airtable empty + portal has company → find-or-create vendor + link
  let vendor = await findVendorByCompany(m.vendorTableId, m.vendorCompanyField, portalCompany!)
  if (!vendor) {
    const fields: Record<string, unknown> = { [m.vendorCompanyField]: portalCompany }
    if (m.vendorEmailField && portalEmail) fields[m.vendorEmailField] = portalEmail
    if (m.vendorPhoneField && portalPhone) fields[m.vendorPhoneField] = portalPhone
    vendor = await createVendor(m.vendorTableId, fields)
    if (collectDeltas) deltas.push({ field: `airtable vendor: ${m.airtableLinkField}`, direction: 'push', oldValue: null, newValue: `created "${portalCompany}"` })
  } else {
    // Existing vendor — only fill missing email/phone on the vendor row.
    const patch: Record<string, unknown> = {}
    if (m.vendorEmailField && portalEmail && isEmptyValue(vendor.fields[m.vendorEmailField])) patch[m.vendorEmailField] = portalEmail
    if (m.vendorPhoneField && portalPhone && isEmptyValue(vendor.fields[m.vendorPhoneField])) patch[m.vendorPhoneField] = portalPhone
    if (Object.keys(patch).length > 0) {
      await patchVendor(m.vendorTableId, vendor.id, patch)
      vendor.fields = { ...vendor.fields, ...patch }
      if (collectDeltas) deltas.push({ field: `airtable vendor: ${m.airtableLinkField}`, direction: 'push', oldValue: null, newValue: `filled ${Object.keys(patch).join('+')} on "${portalCompany}"` })
    }
  }

  // Link the vendor record onto the Deal
  airtablePatch[m.airtableLinkField] = [vendor.id]
  if (collectDeltas) {
    deltas.push({ field: `airtable: ${m.airtableLinkField}`, direction: 'push', oldValue: [], newValue: [vendor.id] })
  }
}

// ============================================================
// Helpers
// ============================================================

function pickString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

function pullIfEmpty(
  src: Record<string, unknown>,
  col: string,
  value: string | null,
  portalDetailPatch: Record<string, unknown>,
  deltas: FieldDelta[],
  collectDeltas: boolean,
) {
  if (!value) return
  if (!isEmptyValue(src[col])) return
  portalDetailPatch[col] = value
  if (collectDeltas) {
    deltas.push({ field: `portal: ${col}`, direction: 'pull', oldValue: src[col], newValue: value })
  }
}

// ============================================================
// Sync all loans
// ============================================================

export interface BatchSyncSummary {
  total: number
  reconciled: number
  pushedFieldsTotal: number
  pulledFieldsTotal: number
  skippedNoDealId: number
  skippedNoAirtableRow: number
  errors: number
  errorSample: Array<{ loanId: string; error: string }>
}

export async function syncAllLoansToAirtable(): Promise<BatchSyncSummary> {
  const supa = createAdminClient()

  const loanIds: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from('loans')
      .select('id')
      .not('pipedrive_deal_id', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    for (const l of data) loanIds.push(l.id)
    if (data.length < 1000) break
  }

  const summary: BatchSyncSummary = {
    total: loanIds.length,
    reconciled: 0,
    pushedFieldsTotal: 0,
    pulledFieldsTotal: 0,
    skippedNoDealId: 0,
    skippedNoAirtableRow: 0,
    errors: 0,
    errorSample: [],
  }

  for (const id of loanIds) {
    try {
      const r = await syncLoanToAirtable(id)
      if (r.status === 'reconciled') {
        summary.reconciled++
        summary.pushedFieldsTotal += r.pushedToAirtable
        summary.pulledFieldsTotal += r.pulledToPortal
      } else if (r.status === 'skipped-no-deal-id') summary.skippedNoDealId++
      else if (r.status === 'skipped-no-airtable-row') summary.skippedNoAirtableRow++
      else if (r.status === 'error') {
        summary.errors++
        if (summary.errorSample.length < 10) summary.errorSample.push({ loanId: id, error: r.error ?? '' })
      }
    } catch (e) {
      summary.errors++
      const msg = e instanceof Error ? e.message : String(e)
      if (summary.errorSample.length < 10) summary.errorSample.push({ loanId: id, error: msg })
    }
  }

  vendorRecordCache.clear()
  return summary
}
