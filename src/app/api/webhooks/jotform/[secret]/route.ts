import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createPerson,
  createDeal,
  fetchDeal,
  resolvePersonOptionId,
} from '@/lib/pipedrive'
import { mapJotForm } from '@/lib/jotform-mapper'
import { PIPEDRIVE_PERSON_FIELDS } from '@/lib/types'

/**
 * JotForm webhook → portal intake.
 *
 * URL: POST /api/webhooks/jotform/{JOTFORM_WEBHOOK_SECRET}
 *
 * Behavior:
 *   - Validates the path secret matches env JOTFORM_WEBHOOK_SECRET.
 *   - Parses the multipart body, extracts rawRequest JSON.
 *   - Maps via jotform-mapper.
 *   - Creates Pipedrive Person + Deal, then mirrors locally:
 *       borrowers (auth_user_id null until invite), loans, loan_details,
 *       loan_demographics, plus a loan_events audit row.
 *   - Idempotent on jotform_submission_id — returning 200 with `duplicate: true`
 *     if the same submission has already been processed.
 *
 * Diagnostic modes:
 *   - `?dry=1` runs the mapper and returns the proposed writes without
 *     touching Pipedrive or the DB. Use this to verify field mapping
 *     before pointing the live form at it.
 *   - The full rawRequest, mapped output, and any unmapped keys are logged
 *     to the Vercel function logs on every invocation.
 */

interface JotFormBody {
  rawRequest: Record<string, unknown>
  submissionId: string | null
  formId: string | null
  formTitle: string | null
}

/**
 * JotForm posts as multipart/form-data with rawRequest as a JSON string.
 * Some test tools / older form configs post application/json with the
 * rawRequest already parsed. We handle both shapes.
 */
async function readJotFormBody(req: NextRequest): Promise<JotFormBody | null> {
  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const json = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!json) return null
    let rawRequest: Record<string, unknown> = {}
    if (typeof json.rawRequest === 'string') {
      try { rawRequest = JSON.parse(json.rawRequest) } catch { rawRequest = {} }
    } else if (json.rawRequest && typeof json.rawRequest === 'object') {
      rawRequest = json.rawRequest as Record<string, unknown>
    }
    return {
      rawRequest,
      submissionId: typeof json.submissionID === 'string' ? json.submissionID : null,
      formId: typeof json.formID === 'string' ? json.formID : null,
      formTitle: typeof json.formTitle === 'string' ? json.formTitle : null,
    }
  }

  // multipart/form-data or application/x-www-form-urlencoded
  const form = await req.formData().catch(() => null)
  if (!form) return null
  const rawString = form.get('rawRequest')
  let rawRequest: Record<string, unknown> = {}
  if (typeof rawString === 'string' && rawString.length > 0) {
    try { rawRequest = JSON.parse(rawString) } catch { rawRequest = {} }
  }
  return {
    rawRequest,
    submissionId: typeof form.get('submissionID') === 'string' ? String(form.get('submissionID')) : null,
    formId:       typeof form.get('formID') === 'string'       ? String(form.get('formID'))       : null,
    formTitle:    typeof form.get('formTitle') === 'string'    ? String(form.get('formTitle'))    : null,
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ secret: string }> },
) {
  const { secret } = await ctx.params
  const expected = process.env.JOTFORM_WEBHOOK_SECRET
  if (!expected) {
    console.error('[jotform] JOTFORM_WEBHOOK_SECRET env var is not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }
  if (secret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry') === '1'

  const body = await readJotFormBody(req)
  if (!body) {
    return NextResponse.json({ error: 'Could not parse webhook body' }, { status: 400 })
  }

  // Always log the raw payload — invaluable for fixing mappings.
  console.log('[jotform] submission received', {
    submissionId: body.submissionId,
    formId: body.formId,
    formTitle: body.formTitle,
    rawKeys: Object.keys(body.rawRequest),
  })

  const mapped = mapJotForm(body.rawRequest, body.submissionId)
  // Redact SSN before logging — Vercel logs are not the right place for PII.
  const safeForLog = JSON.parse(JSON.stringify(mapped)) as typeof mapped
  if (safeForLog.pipedrivePerson?.ssn) safeForLog.pipedrivePerson.ssn = '***REDACTED***'
  console.log('[jotform] mapped', JSON.stringify(safeForLog, null, 2))

  if (dryRun) {
    return NextResponse.json({ dryRun: true, mapped, rawRequest: body.rawRequest })
  }

  const supabase = createAdminClient()

  // ===== Idempotency =====
  if (body.submissionId) {
    const { data: existing } = await supabase
      .from('loan_details')
      .select('loan_id')
      .eq('jotform_submission_id', body.submissionId)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({
        duplicate: true,
        loanId: existing.loan_id,
        message: 'Submission already processed',
      })
    }
  }

  // ===== Resolve Pipedrive Person enum option IDs =====
  let usCitizenOptionId: number | null = null
  let maritalStatusOptionId: number | null = null
  try {
    if (mapped.pipedrivePerson.usCitizenLabel) {
      usCitizenOptionId = await resolvePersonOptionId(
        PIPEDRIVE_PERSON_FIELDS.usCitizen,
        mapped.pipedrivePerson.usCitizenLabel,
      )
    }
    if (mapped.pipedrivePerson.maritalStatusLabel) {
      maritalStatusOptionId = await resolvePersonOptionId(
        PIPEDRIVE_PERSON_FIELDS.maritalStatus,
        mapped.pipedrivePerson.maritalStatusLabel,
      )
    }
  } catch (err) {
    console.warn('[jotform] option resolution failed (continuing without):', err)
  }

  // ===== Create Pipedrive Person =====
  let personId: number
  try {
    const personCustomFields: Record<string, string | number | null> = {}
    if (mapped.pipedrivePerson.ssn)        personCustomFields[PIPEDRIVE_PERSON_FIELDS.ssn] = mapped.pipedrivePerson.ssn
    if (mapped.pipedrivePerson.birthDate)  personCustomFields[PIPEDRIVE_PERSON_FIELDS.birthDate] = mapped.pipedrivePerson.birthDate
    if (usCitizenOptionId !== null)        personCustomFields[PIPEDRIVE_PERSON_FIELDS.usCitizen] = usCitizenOptionId
    if (maritalStatusOptionId !== null)    personCustomFields[PIPEDRIVE_PERSON_FIELDS.maritalStatus] = maritalStatusOptionId

    personId = await createPerson({
      name: mapped.pipedrivePerson.name,
      email: mapped.pipedrivePerson.email ?? undefined,
      phone: mapped.pipedrivePerson.phone ?? undefined,
      customFields: personCustomFields,
    })
  } catch (err) {
    console.error('[jotform] Pipedrive person create failed:', err)
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Pipedrive person create failed: ${msg}` }, { status: 502 })
  }

  // ===== Create Pipedrive Deal =====
  let dealId: number
  try {
    dealId = await createDeal({
      title: mapped.pipedriveDeal.title,
      personId,
      value: mapped.pipedriveDeal.value ?? undefined,
      currency: mapped.pipedriveDeal.currency,
      customFields: mapped.pipedriveDeal.customFields,
      // stageId omitted — Pipedrive will use the pipeline default
    })
  } catch (err) {
    console.error('[jotform] Pipedrive deal create failed:', err)
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Pipedrive deal create failed: ${msg}`, personId }, { status: 502 })
  }

  // ===== Borrower upsert (by email if available; else create) =====
  let borrowerId: string | null = null
  if (mapped.borrower.email) {
    const { data: existing } = await supabase
      .from('borrowers')
      .select('id')
      .eq('email', mapped.borrower.email)
      .maybeSingle()
    if (existing) {
      borrowerId = existing.id
      // Update with any new info
      await supabase
        .from('borrowers')
        .update({
          full_name: mapped.borrower.full_name,
          phone: mapped.borrower.phone,
          pipedrive_person_id: personId,
          current_address_street: mapped.borrower.current_address_street,
          current_address_city:   mapped.borrower.current_address_city,
          current_address_state:  mapped.borrower.current_address_state,
          current_address_zip:    mapped.borrower.current_address_zip,
          at_current_address_2y:  mapped.borrower.at_current_address_2y,
          prior_address_street:   mapped.borrower.prior_address_street,
          prior_address_city:     mapped.borrower.prior_address_city,
          prior_address_state:    mapped.borrower.prior_address_state,
          prior_address_zip:      mapped.borrower.prior_address_zip,
        })
        .eq('id', existing.id)
    } else {
      const { data: created, error: bErr } = await supabase
        .from('borrowers')
        .insert({
          email: mapped.borrower.email,
          full_name: mapped.borrower.full_name,
          phone: mapped.borrower.phone,
          pipedrive_person_id: personId,
          current_address_street: mapped.borrower.current_address_street,
          current_address_city:   mapped.borrower.current_address_city,
          current_address_state:  mapped.borrower.current_address_state,
          current_address_zip:    mapped.borrower.current_address_zip,
          at_current_address_2y:  mapped.borrower.at_current_address_2y,
          prior_address_street:   mapped.borrower.prior_address_street,
          prior_address_city:     mapped.borrower.prior_address_city,
          prior_address_state:    mapped.borrower.prior_address_state,
          prior_address_zip:      mapped.borrower.prior_address_zip,
        })
        .select('id')
        .single()
      if (bErr) {
        console.warn('[jotform] borrower insert failed (continuing without borrower row):', bErr.message)
      } else {
        borrowerId = created?.id ?? null
      }
    }
  }

  // ===== Resolve loan officer by name (if borrower selected one) =====
  let loanOfficerId: string | null = null
  if (mapped.meta.loanOfficerName) {
    const name = mapped.meta.loanOfficerName.trim()
    const { data: lo } = await supabase
      .from('loan_officers')
      .select('id, full_name')
      .ilike('full_name', name)
      .maybeSingle()
    if (lo) {
      loanOfficerId = lo.id
    } else {
      console.warn(`[jotform] no loan_officer match for "${name}" — leaving unassigned`)
    }
  }

  // ===== Loans row — pull canonical Pipedrive view, then upsert =====
  let loanId: string | null = null
  try {
    const normalized = await fetchDeal(dealId)
    if (!normalized) throw new Error(`fetchDeal returned no data for ${dealId}`)
    const { data: loanRow, error: loanErr } = await supabase
      .from('loans')
      .upsert(
        {
          pipedrive_deal_id:         normalized.pipedrive_deal_id,
          property_address:          normalized.property_address,
          pipeline_stage:            normalized.pipeline_stage,
          loan_type:                 normalized.loan_type,
          loan_amount:               normalized.loan_amount,
          interest_rate:             normalized.interest_rate,
          ltv:                       normalized.ltv,
          arv:                       normalized.arv,
          rehab_budget:              normalized.rehab_budget,
          term_months:               normalized.term_months ? Math.round(normalized.term_months) : null,
          origination_date:          normalized.origination_date,
          maturity_date:             normalized.maturity_date,
          entity_name:               normalized.entity_name,
          loan_number:               normalized.loan_number,
          rate_locked_days:          normalized.rate_locked_days,
          rate_lock_expiration_date: normalized.rate_lock_expiration_date,
          interest_only:             normalized.interest_only,
          loan_type_ii:              normalized.loan_type_ii,
          borrower_id:               borrowerId,
          loan_officer_id:           loanOfficerId,
          last_synced_at:            new Date().toISOString(),
        },
        { onConflict: 'pipedrive_deal_id' },
      )
      .select('id')
      .single()
    if (loanErr || !loanRow) throw new Error(loanErr?.message ?? 'loan upsert returned no row')
    loanId = loanRow.id
  } catch (err) {
    console.error('[jotform] loan upsert failed:', err)
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({
      error: `Local loan upsert failed: ${msg}`,
      personId,
      dealId,
    }, { status: 500 })
  }

  // ===== loan_details upsert =====
  try {
    const { error: ldErr } = await supabase
      .from('loan_details')
      .upsert(
        { loan_id: loanId, ...mapped.loanDetails, updated_at: new Date().toISOString() },
        { onConflict: 'loan_id' },
      )
    if (ldErr) throw new Error(ldErr.message)
  } catch (err) {
    console.error('[jotform] loan_details upsert failed:', err)
  }

  // ===== loan_demographics upsert (only if any field is set) =====
  const hasDemographics =
    mapped.loanDemographics.ethnicity ||
    mapped.loanDemographics.race ||
    mapped.loanDemographics.sex
  if (hasDemographics) {
    try {
      const { error: dErr } = await supabase
        .from('loan_demographics')
        .upsert(
          {
            loan_id: loanId,
            ethnicity: mapped.loanDemographics.ethnicity,
            race: mapped.loanDemographics.race,
            sex: mapped.loanDemographics.sex,
            source: 'jotform_application',
          },
          { onConflict: 'loan_id' },
        )
      if (dErr) throw new Error(dErr.message)
    } catch (err) {
      console.error('[jotform] loan_demographics upsert failed:', err)
    }
  }

  // ===== Audit log =====
  try {
    await supabase.from('loan_events').insert({
      loan_id: loanId,
      event_type: 'application_received',
      description: `Loan application received from JotForm (submission ${body.submissionId ?? 'unknown'}) — Pipedrive deal #${dealId}, person #${personId}`,
    })
  } catch (err) {
    console.error('[jotform] event log failed:', err)
  }

  return NextResponse.json({
    success: true,
    loanId,
    pipedrive: { personId, dealId },
    unmappedKeys: Object.keys(mapped.unmapped),
  })
}
