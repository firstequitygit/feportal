// Bidirectional sync between portal Loan Details and the First Equity
// Reports Airtable base (Deals table + linked Title/Insurance/Appraisers
// tables).
//
// Sync model — "portal wins, Airtable backfills":
//   - Portal has value             → push portal → Airtable (overwrites)
//   - Portal empty, Airtable value → pull Airtable → portal (fill the blank)
//   - Both empty                   → no-op
//
// Earlier this was "fill blanks only on both sides" — bidirectional but
// conservative. Problem: portal edits never propagated to Airtable when
// the field there already had any value (even from an older sync), so
// staff couldn't update Points / Construction Holdback / etc. Portal is
// now the canonical source; Airtable still seeds initial data on fields
// the portal hasn't populated yet.
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
// Global pause switch
// ============================================================
//
// Flip to `false` to restore syncing. While paused:
//   - the hourly /api/cron/sync-airtable cron returns early with a
//     paused summary and pushes nothing
//   - the admin sidebar "Sync Next Batch" button reports paused
//   - the per-loan "Sync to Airtable" button reports paused
//   - inline pushes triggered by stage / status changes no-op so
//     the underlying portal write still succeeds
//
// Re-enabling: flip the constant + ship. No backfill needed — the
// field map's "portal wins, Airtable backfills" rule is stateless
// and reconciles whatever drift accumulated on the next sync.
export const AIRTABLE_SYNC_PAUSED = false

function pausedNoop(): boolean {
  return AIRTABLE_SYNC_PAUSED
}

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
// Schema cache — singleSelect option lists from the Deals table
// ============================================================
//
// Why: portal text fields can drift from the curated singleSelect choices
// in Airtable (e.g. portal stores free-text "5/4/3/2/1" for Prepayment
// Penalty but Airtable's only options are "1 Year", "2 Year", etc.). If
// we push an unknown choice, Airtable rejects the whole PATCH with a 422
// (typecast: true doesn't help — that just coerces strings, it can't
// create new options without schema.bases:write scope which our token
// doesn't have).
//
// Strategy: fetch the schema once per process, keep a per-field set of
// allowed options, and skip the push for any portal value not in the set.
// The rest of the PATCH still goes through. Misses are logged so we can
// notice and either map the portal value or add the Airtable option.

interface AirtableFieldSchema {
  type: string
  options?: Set<string>
}

// Airtable field types whose values are computed by Airtable itself —
// any write attempt fails with INVALID_PERMISSIONS. We detect these from
// the schema fetch and skip them automatically.
const READ_ONLY_FIELD_TYPES = new Set<string>([
  'formula',
  'rollup',
  'lookup',
  'multipleLookupValues',
  'count',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'autoNumber',
  'button',
  'externalSyncSource',
])

// Process-level cache of fields we've discovered are unwritable at
// runtime (i.e., the schema looked writable but Airtable returned 403
// INVALID_PERMISSIONS when we actually tried). Common cause: enterprise
// field-level permissions that the Metadata API doesn't expose. Stays
// in memory for the lifetime of the serverless container so subsequent
// syncs in the same process skip the field instead of repeatedly hitting
// the same 403.
const runtimeReadOnlyFields = new Set<string>()

let dealsSchemaCache: Map<string, AirtableFieldSchema> | null = null
let dealsSchemaPromise: Promise<Map<string, AirtableFieldSchema>> | null = null

interface MetaApiField {
  name: string
  type: string
  options?: { choices?: Array<{ name: string }> }
}
interface MetaApiTable {
  id: string
  name: string
  fields: MetaApiField[]
}

async function fetchDealsTableSchema(): Promise<Map<string, AirtableFieldSchema>> {
  if (dealsSchemaCache) return dealsSchemaCache
  if (dealsSchemaPromise) return dealsSchemaPromise
  dealsSchemaPromise = (async () => {
    try {
      const res = await airtable<{ tables: MetaApiTable[] }>(`/meta/bases/${AIRTABLE_BASE_ID}/tables`)
      const deals = res.tables.find(t => t.id === AIRTABLE_DEALS_TABLE_ID)
      const map = new Map<string, AirtableFieldSchema>()
      if (deals) {
        for (const f of deals.fields) {
          const entry: AirtableFieldSchema = { type: f.type }
          if (f.options?.choices) {
            entry.options = new Set(f.options.choices.map(c => c.name))
          }
          map.set(f.name, entry)
        }
      }
      dealsSchemaCache = map
      return map
    } catch (e) {
      // Schema fetch is best-effort. Most common failure mode is the
      // AIRTABLE_TOKEN missing the schema.bases:read scope — in which case
      // the Metadata API returns 403. We don't want to brick every sync
      // over that; fall back to an empty schema so skip-on-mismatch becomes
      // a no-op and pushes proceed as they did before this feature shipped.
      console.warn('[airtable] schema fetch failed, skip-on-mismatch disabled this run:', e instanceof Error ? e.message : String(e))
      const empty = new Map<string, AirtableFieldSchema>()
      dealsSchemaCache = empty
      return empty
    }
  })()
  try {
    return await dealsSchemaPromise
  } finally {
    dealsSchemaPromise = null
  }
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
// Loan Status push (one-way, on demand)
// ============================================================
//
// Used by /api/loans/status when a loan is cancelled, put on hold, or
// reactivated. Pushes the 'Loan Status' singleSelect field on the matching
// Deals row. Pass null to clear (used when reactivating).
//
// Loan Status field is a singleSelect with at least these options:
//   - "Canceled"    (American spelling — matches Airtable's existing option)
//   - "On Hold"
// Anything else for `statusLabel` is rejected by Airtable if not configured;
// we let that error propagate so it surfaces in logs.
//
// Match key is the Pipedrive Deal ID, same as the bidirectional sync.
// Loans with no matching Airtable row are silently skipped — not every deal
// makes it to Airtable.

const AIRTABLE_LOAN_STATUS_FIELD = 'Loan Status'

export async function pushLoanStatusToAirtable(
  pipedriveDealId: string,
  statusLabel: 'Canceled' | 'On Hold' | null,
): Promise<{ updated: boolean; recordId?: string; paused?: boolean }> {
  if (pausedNoop()) return { updated: false, paused: true }
  const dealRecord = await findDealByPipedriveId(pipedriveDealId)
  if (!dealRecord) return { updated: false }

  await airtable(`/${AIRTABLE_BASE_ID}/${AIRTABLE_DEALS_TABLE_ID}/${dealRecord.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: { [AIRTABLE_LOAN_STATUS_FIELD]: statusLabel },
      typecast: true,
    }),
  })

  return { updated: true, recordId: dealRecord.id }
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
  status: 'reconciled' | 'skipped-no-deal-id' | 'skipped-no-airtable-row' | 'paused' | 'error'
  airtableRecordId?: string
  pushedToAirtable: number      // number of Airtable fields filled in
  pulledToPortal: number        // number of portal columns filled in
  deltas?: FieldDelta[]
  error?: string
}

export async function syncLoanToAirtable(loanId: string, opts: { collectDeltas?: boolean } = {}): Promise<SyncResult> {
  if (pausedNoop()) {
    return { loanId, status: 'paused', pushedToAirtable: 0, pulledToPortal: 0 }
  }
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
  const rawDealId = loan.pipedrive_deal_id
  if (rawDealId === null || rawDealId === undefined || rawDealId === '') {
    return { loanId, status: 'skipped-no-deal-id', pushedToAirtable: 0, pulledToPortal: 0 }
  }
  // pipedrive_deal_id is INT4 in Postgres → Supabase returns a JS number.
  // findDealByPipedriveId needs a string for the Airtable formula. Coerce
  // here so number/string variants both work without breaking the lookup.
  const dealId = String(rawDealId)

  const { data: detail } = await supa
    .from('loan_details')
    .select(portalLoanDetailsColumns().join(','))
    .eq('loan_id', loanId)
    .maybeSingle()
  const detailRow = (detail ?? null) as Record<string, unknown> | null

  // 2. Find Airtable Deal record (full fields) + schema in parallel.
  //    Schema is used by reconcileScalar to drop singleSelect pushes whose
  //    portal value isn't one of the curated Airtable choices (otherwise the
  //    whole PATCH 422s).
  const [dealRecord, schema] = await Promise.all([
    findDealByPipedriveId(dealId),
    fetchDealsTableSchema(),
  ])
  if (!dealRecord) {
    return { loanId, status: 'skipped-no-airtable-row', pushedToAirtable: 0, pulledToPortal: 0 }
  }

  const airtableFields = dealRecord.fields
  const airtablePatch: Record<string, unknown> = {}
  const portalLoanPatch: Record<string, unknown> = {}
  const portalDetailPatch: Record<string, unknown> = {}
  const deltas: FieldDelta[] = []

  // 3. Reconcile each scalar mapping
  //
  // The Airtable "Loan Status" cell is shared between two systems —
  // pipeline stages (this sync) and lifecycle states (pushLoanStatusToAirtable
  // writes Canceled / On Hold there). When the loan is currently on hold
  // or cancelled, we skip the pipeline_stage push so the hourly cron
  // doesn't overwrite "On Hold" with the underlying stage. The lifecycle
  // push reclaims the cell on the next status transition.
  const loanStatus = loan.loan_status as string | null
  const lifecycleOwnsLoanStatusField = loanStatus === 'on_hold' || loanStatus === 'cancelled'
  for (const m of FIELD_MAP) {
    if (m.kind !== 'scalar') continue
    if (lifecycleOwnsLoanStatusField && m.portalCol === 'pipeline_stage' && m.airtableField === 'Loan Status') {
      continue
    }
    reconcileScalar(m, loan, detailRow, airtableFields, airtablePatch, portalLoanPatch, portalDetailPatch, deltas, collectDeltas, schema)
  }

  // 4. Reconcile each vendor mapping (linked-table)
  for (const m of FIELD_MAP) {
    if (m.kind !== 'vendor') continue
    await reconcileVendor(m, detailRow, airtableFields, airtablePatch, portalDetailPatch, deltas, collectDeltas)
  }

  // 5. Apply Airtable changes (PATCH the Deal — typecast lets Airtable coerce
  //    text into enum choices when values match).
  //
  // Some Airtable bases have field-level permissions that the Metadata API
  // doesn't expose (enterprise feature). When a write hits one, Airtable
  // returns 403 INVALID_PERMISSIONS naming the field. We extract that name,
  // add it to runtimeReadOnlyFields so future syncs in this process skip
  // it automatically, drop it from the current patch, and retry once.
  // Bounded retry — at most a handful of iterations, then give up.
  let pushedToAirtable = 0
  if (Object.keys(airtablePatch).length > 0) {
    let attempts = 0
    while (Object.keys(airtablePatch).length > 0 && attempts < 6) {
      attempts++
      try {
        await airtable(`/${AIRTABLE_BASE_ID}/${AIRTABLE_DEALS_TABLE_ID}/${dealRecord.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: airtablePatch, typecast: true }),
        })
        pushedToAirtable = Object.keys(airtablePatch).length
        break
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Parse the field name out of Airtable's 403 message. Example:
        //   Airtable 403 on /...: {"error":{"type":"INVALID_PERMISSIONS",
        //   "message":"You are not permitted to write cell values in field Closing Date (fldWOrNQRRydluK9I)"}}
        const match = /INVALID_PERMISSIONS[\s\S]*?in field ([^"(]+?)(?:\s*\([^)]*\))?(?:["\\])/.exec(msg)
        const offendingField = match?.[1]?.trim()
        if (offendingField && airtablePatch[offendingField] !== undefined) {
          console.warn(`[airtable] field "${offendingField}" is not writable for this token — skipping for the rest of this process`)
          runtimeReadOnlyFields.add(offendingField)
          delete airtablePatch[offendingField]
          continue  // retry without it
        }
        throw e  // not an INVALID_PERMISSIONS we can recover from
      }
    }
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

// Updated sync model — "portal wins, Airtable backfills":
//   portal has value             → push portal → Airtable (always overwrites)
//   portal empty, airtable value → pull Airtable → portal (fill the blank)
//   both empty                   → no-op
//
// Previously this was "fill blanks only on both sides", which silently
// refused to push portal updates whenever Airtable already had any value
// in the same field. The portal is now treated as the source of truth;
// Airtable still seeds initial portal data on fields the portal hasn't
// populated yet.
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
  schema: Map<string, AirtableFieldSchema>,
) {
  const src = m.portalTable === 'loans' ? loan : (detail ?? {})
  const portalValue = src[m.portalCol]
  const airtableValue = airtableFields[m.airtableField]

  const portalEmpty = isEmptyValue(portalValue)
  const airtableEmpty = isEmptyValue(airtableValue)

  // Both empty → nothing to sync.
  if (portalEmpty && airtableEmpty) return

  if (!portalEmpty) {
    // Portal has a value → push it (overwrites any existing Airtable value).
    const v = m.toAirtable ? m.toAirtable(portalValue) : portalValue
    if (v === undefined) return
    // Skip the patch when Airtable already holds the same value — avoids
    // unnecessary writes / API calls on a no-op sync.
    if (!airtableEmpty && airtableValue === v) return
    // Skip computed/locked Airtable fields. Two flavors:
    //   - schema-declared read-only types (formula, rollup, lookup, etc.)
    //     — these never accept writes.
    //   - fields discovered to be unwritable at runtime (enterprise
    //     field-level permissions that the schema doesn't expose).
    //     Populated by the patch handler below on INVALID_PERMISSIONS.
    const fieldSchema = schema.get(m.airtableField)
    if (fieldSchema && READ_ONLY_FIELD_TYPES.has(fieldSchema.type)) {
      return
    }
    if (runtimeReadOnlyFields.has(m.airtableField)) {
      return
    }
    // Skip-on-mismatch for singleSelect fields. If the portal value isn't
    // one of Airtable's curated choices, we drop the push silently rather
    // than letting Airtable reject the whole PATCH. Other fields in the
    // same sync still go through.
    if (fieldSchema?.type === 'singleSelect' && fieldSchema.options && typeof v === 'string' && !fieldSchema.options.has(v)) {
      console.warn(`[airtable] skipping ${m.airtableField}: portal value "${v}" not in Airtable choices`)
      return
    }
    airtablePatch[m.airtableField] = v
    if (collectDeltas) {
      deltas.push({ field: `airtable: ${m.airtableField}`, direction: 'push', oldValue: airtableValue, newValue: v })
    }
  } else if (!airtableEmpty) {
    // Portal empty, Airtable has value → pull it into portal.
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
  /** Set when AIRTABLE_SYNC_PAUSED is on — every other field is 0 and
   *  callers should toast a paused state instead of a success summary. */
  paused?: boolean
}

/**
 * Sync many loans to Airtable.
 *
 * Options:
 *   - limit: cap the number of loans processed in this call. Used by the
 *     hourly cron to stay under Vercel's per-request timeout. When omitted,
 *     processes every loan (which only completes safely when called from a
 *     long-running context, like a local script).
 *   - oldestFirst: when true, order by airtable_last_synced_at nulls first
 *     so unsynced/stalest loans are picked up before recently-synced ones.
 *     Combined with `limit`, this lets repeated cron runs rotate through
 *     the whole base over time.
 *
 * On reconcile, the loan's airtable_last_synced_at is updated so the next
 * cron run skips past it.
 */
export async function syncAllLoansToAirtable(
  opts: { limit?: number; oldestFirst?: boolean } = {},
): Promise<BatchSyncSummary> {
  if (pausedNoop()) {
    return {
      total: 0,
      reconciled: 0,
      pushedFieldsTotal: 0,
      pulledFieldsTotal: 0,
      skippedNoDealId: 0,
      skippedNoAirtableRow: 0,
      errors: 0,
      errorSample: [],
      paused: true,
    }
  }
  const supa = createAdminClient()
  const { limit, oldestFirst = false } = opts

  // Fetch loan IDs to process. Ordered by staleness when oldestFirst=true.
  const loanIds: string[] = []
  const pageSize = limit ? Math.min(limit, 1000) : 1000
  let from = 0
  while (true) {
    let q = supa
      .from('loans')
      .select('id')
      .not('pipedrive_deal_id', 'is', null)
    if (oldestFirst) {
      q = q.order('airtable_last_synced_at', { ascending: true, nullsFirst: true })
    }
    const { data, error } = await q.range(from, from + pageSize - 1)
    // Supabase errors are plain objects, not Error instances. If we
    // `throw error` directly the outer catch's `String(e)` becomes
    // "[object Object]" — useless. Wrap in a real Error so the message
    // makes it back to the toast.
    if (error) throw new Error(`Supabase loan-list query failed: ${error.message ?? JSON.stringify(error)}`)
    if (!data?.length) break
    for (const l of data) {
      loanIds.push(l.id)
      if (limit && loanIds.length >= limit) break
    }
    if (limit && loanIds.length >= limit) break
    if (data.length < pageSize) break
    from += pageSize
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
      // Stamp the loan so the cron's "oldest first" ordering rotates past
      // it on the next run. Also stamp on no-match (Airtable row missing)
      // so we don't keep retrying the same orphan every hour. We DON'T
      // stamp on error so failures get retried next cycle.
      if (r.status === 'reconciled' || r.status === 'skipped-no-airtable-row') {
        await supa.from('loans')
          .update({ airtable_last_synced_at: new Date().toISOString() })
          .eq('id', id)
          .then(() => {}, err => console.error(`stamp airtable_last_synced_at failed for ${id}:`, err))
      }
    } catch (e) {
      summary.errors++
      // Same defense as the route catch — plain objects (Supabase errors,
      // typed network errors) String() to "[object Object]".
      let msg: string
      if (e instanceof Error) msg = e.message
      else if (e && typeof e === 'object') {
        const o = e as Record<string, unknown>
        msg = typeof o.message === 'string' ? o.message : JSON.stringify(e).slice(0, 300)
      } else msg = String(e)
      if (summary.errorSample.length < 10) summary.errorSample.push({ loanId: id, error: msg })
    }
  }

  vendorRecordCache.clear()
  return summary
}
