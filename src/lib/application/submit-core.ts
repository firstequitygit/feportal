import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ApplicationData } from '@/lib/application-fields'
import { mapApplication } from './mapper'
import { missingRequired, type ValidationContext } from './validate'
import {
  sendBorrowerSubmittedNotifications,
  sendBrokerSubmittedNotifications,
} from './notify'
import { sendNewApplicantAccessEmail } from './new-account-email'

export type Variant = 'borrower' | 'broker'

export interface SubmitDraftOpts {
  variant?: Variant
  submittedByBrokerId?: string | null
}

export type SubmitResult =
  | { ok: true; loanId: string | null; authorizeToken?: string | null; alreadySubmitted?: boolean }
  | { ok: false; status: number; error: string; missing?: string[] }

/** Finalize a draft `loan_applications` row → portal rows. Pure side-effecting
 *  helper; routes wrap it with auth + rate limiting. Idempotent for already-
 *  submitted drafts (returns existing loanId). Notifications run in `after()`
 *  off the response critical path. */
export async function submitApplication(
  appRow: { id: string; status: string | null; data: ApplicationData; submitted_loan_id: string | null },
  opts: SubmitDraftOpts = {},
): Promise<SubmitResult> {
  const variant: Variant = opts.variant ?? 'borrower'

  if (appRow.status === 'submitted') {
    return { ok: true, loanId: appRow.submitted_loan_id, alreadySubmitted: true }
  }

  const data = appRow.data ?? {}
  const ctx: ValidationContext = { variant }
  const miss = missingRequired(data, ctx)
  if (miss.length) {
    return { ok: false, status: 422, error: 'Some required fields are missing', missing: miss }
  }

  const m = mapApplication(data, { variant })
  const admin = createAdminClient()

  // 1. Insert borrowers (upsert on email — email is UNIQUE NOT NULL).
  const borrowerIds: (string | null)[] = []
  for (const bw of m.borrowers) {
    if (!bw.email) { borrowerIds.push(null); continue }
    const fullPayload: Record<string, unknown> = {
      email: bw.email.toLowerCase(), full_name: bw.full_name, phone: bw.phone, entity_name: bw.entity_name,
      current_address_street: bw.current_address_street, current_address_city: bw.current_address_city,
      current_address_state: bw.current_address_state, current_address_zip: bw.current_address_zip,
      at_current_address_2y: bw.at_current_address_2y,
      prior_address_street: bw.prior_address_street, prior_address_city: bw.prior_address_city,
      prior_address_state: bw.prior_address_state, prior_address_zip: bw.prior_address_zip,
    }
    const payload = Object.fromEntries(
      Object.entries(fullPayload).filter(([k, v]) =>
        k === 'email' || k === 'full_name' || (v !== null && v !== undefined)),
    )
    const { data: brow, error: berr } = await admin
      .from('borrowers')
      .upsert(payload, { onConflict: 'email' })
      .select('id').single()
    if (berr || !brow) return { ok: false, status: 500, error: 'Failed to save borrower' }
    borrowerIds.push(brow.id)
  }

  // 2. Insert loan. Mint a per-loan authorize_token so the borrower's
  //    separate credit-auth + payment step at /authorize/<token> has a
  //    stable URL. application_kind defaults to 'borrower' for historical
  //    rows in the DB; we set it explicitly here to match the variant
  //    that just submitted.
  //
  //    For borrower-variant submissions, the borrower already signed +
  //    saved their card inline at Step 5, so the loan is fully authorized
  //    at insert time: status='signed', signed_at=now, and the payment_ref
  //    is the Square card id we captured during /api/apply/payment. The
  //    /authorize route is irrelevant for them. Brokers go in as 'pending'
  //    and flip to 'signed' when the borrower completes /authorize.
  const authorizeToken = crypto.randomUUID()
  let borrowerSignedCardId: string | null = null
  if (variant === 'borrower') {
    const { data: cardRow } = await admin
      .from('loan_applications')
      .select('square_card_id')
      .eq('id', appRow.id)
      .maybeSingle()
    borrowerSignedCardId = (cardRow?.square_card_id as string | null) ?? null
  }
  const nowIso = new Date().toISOString()
  const { data: loanRow, error: lerr } = await admin
    .from('loans')
    .insert({
      pipedrive_deal_id: null,
      borrower_id: borrowerIds[0] ?? null,
      borrower_id_2: borrowerIds[1] ?? null,
      borrower_id_3: borrowerIds[2] ?? null,
      borrower_id_4: borrowerIds[3] ?? null,
      property_address: m.loan.property_address,
      loan_type: m.loan.loan_type,
      loan_amount: m.loan.loan_amount,
      entity_name: m.loan.entity_name,
      pipeline_stage: 'New Application',
      application_kind: variant,
      submitted_by_broker_id: opts.submittedByBrokerId ?? null,
      authorize_token: authorizeToken,
      authorization_status: variant === 'borrower' ? 'signed' : 'pending',
      authorization_signed_at: variant === 'borrower' ? nowIso : null,
      authorization_payment_ref: variant === 'borrower' ? borrowerSignedCardId : null,
    })
    .select('id').single()
  if (lerr || !loanRow) return { ok: false, status: 500, error: 'Failed to create loan' }
  const loanId = loanRow.id

  // 3. loan_details + loan_demographics. On hard failure, roll back the loan
  //    (FK ON DELETE CASCADE cleans children) and leave the draft as 'draft'.
  const { error: ldErr } = await admin.from('loan_details').upsert(
    { loan_id: loanId, ...m.loanDetails, updated_at: new Date().toISOString() },
    { onConflict: 'loan_id' })
  if (ldErr) {
    await admin.from('loans').delete().eq('id', loanId)
    return { ok: false, status: 500, error: 'Could not finalize application' }
  }
  if (m.loanDemographics.ethnicity || m.loanDemographics.race || m.loanDemographics.sex) {
    const { error: dErr } = await admin.from('loan_demographics').upsert(
      { loan_id: loanId, ...m.loanDemographics, source: 'loan_application' },
      { onConflict: 'loan_id' })
    if (dErr) {
      await admin.from('loans').delete().eq('id', loanId)
      return { ok: false, status: 500, error: 'Could not finalize application' }
    }
  }

  // 4. Mark draft submitted + link loan. On failure, roll back the loan so a
  //    retry does not create a duplicate (draft stays 'draft').
  const { error: appErr } = await admin.from('loan_applications')
    .update({ status: 'submitted', submitted_loan_id: loanId })
    .eq('id', appRow.id)
  if (appErr) {
    await admin.from('loans').delete().eq('id', loanId)
    return { ok: false, status: 500, error: 'Could not finalize application' }
  }

  // 5. Audit (best-effort — non-fatal if it fails).
  await admin.from('loan_events').insert({
    loan_id: loanId, event_type: 'application_received',
    description: `Loan application submitted via portal (application ${appRow.id})`,
  })

  // 6. Notifications (best-effort, off the response critical path).
  after(async () => {
    try {
      if (variant === 'broker') {
        await sendBrokerSubmittedNotifications({ loanId, data, m, variant, submittedByBrokerId: opts.submittedByBrokerId ?? null })
      } else {
        await sendBorrowerSubmittedNotifications({ loanId, data, m, variant })
      }
    } catch (err) {
      console.error('Application notifications failed:', err)
    }
  })

  // 7. New-borrower portal account + access email (borrower variant only),
  //    off the response critical path. The borrowers row was upserted in step 1
  //    without an auth_user_id; if it is still unlinked, this is a brand-new
  //    borrower and we create their account + email them access instructions.
  //    A returning borrower already has auth_user_id, so this is a no-op and no
  //    duplicate access email is sent. A mail/auth failure never fails submit.
  if (variant === 'borrower') {
    const primaryEmail = m.borrowers[0]?.email?.toLowerCase() ?? null
    const primaryName = m.borrowers[0]?.full_name ?? undefined
    if (primaryEmail) {
      after(async () => {
        try {
          const { data: brow } = await admin
            .from('borrowers')
            .select('auth_user_id')
            .eq('email', primaryEmail)
            .maybeSingle()
          if (brow && !brow.auth_user_id) {
            await sendNewApplicantAccessEmail(primaryEmail, primaryName)
          }
        } catch (err) {
          console.error('New applicant access email failed:', err)
        }
      })
    }
  }

  return { ok: true, loanId, authorizeToken }
}
