// Builds the Term Sheet e-sign package: the rendered React-PDF Term
// Sheet (with invisible signature tags over the Acceptance block) plus
// the W-9 appended as the last page, per First Equity's send policy.
// The W-9's Line 1 is stamped from the loan's entity name (falling
// back to the primary borrower's name for individually-vested loans),
// and the requester block is stamped with First Equity's address.
//
// Returns the merged PDF and the full explicit BoldSign field list:
// Term Sheet fields extracted from its tags + the W-9's configured
// fields shifted to the appended page. Shared by the send route
// (/api/esign/term-sheet/[id]/send) and the E-Signature page preview.

import fs from 'fs'
import path from 'path'
import type { createAdminClient } from '@/lib/supabase/admin'
import { renderTermSheetPdf } from '@/lib/pdf/term-sheet-pdf'
import { formatLoanName } from '@/lib/format-loan-name'
import { getEsignForm } from './forms'
import { appendFormToPdf } from './fill-form'
import { extractTagFields, type BoldSignFormField } from './tag-fields'

type AdminClient = ReturnType<typeof createAdminClient>

export interface TermSheetPackage {
  pdf: Buffer
  fields: BoldSignFormField[]
  borrower: { full_name: string | null; email: string | null }
  loanName: string
}

export interface TermSheetPackageError {
  error: string
  status: number
}

export async function buildTermSheetPackage(
  adminClient: AdminClient,
  loanId: string,
): Promise<TermSheetPackage | TermSheetPackageError> {
  // Same data fetch as the PDF download route.
  const { data: loan } = await adminClient
    .from('loans')
    .select(`
      *,
      borrowers!borrower_id(full_name, email, current_address_street, current_address_city, current_address_state, current_address_zip),
      borrower_2:borrowers!borrower_id_2(full_name),
      borrower_3:borrowers!borrower_id_3(full_name),
      borrower_4:borrowers!borrower_id_4(full_name)
    `)
    .eq('id', loanId)
    .single()
  if (!loan) return { error: 'Loan not found', status: 404 }

  const borrower = loan.borrowers as unknown as {
    full_name: string | null
    email: string | null
    current_address_street: string | null
    current_address_city: string | null
    current_address_state: string | null
    current_address_zip: string | null
  } | null

  const co1 = (loan as unknown as { borrower_2: { full_name: string | null } | null }).borrower_2
  const co2 = (loan as unknown as { borrower_3: { full_name: string | null } | null }).borrower_3
  const co3 = (loan as unknown as { borrower_4: { full_name: string | null } | null }).borrower_4
  const coBorrowerNames = [co1?.full_name, co2?.full_name, co3?.full_name]
    .filter((x): x is string => !!x)

  const { data: details } = await adminClient
    .from('loan_details')
    .select(`
      rate_type, amortization_schedule, prepayment_penalty,
      points, broker_points,
      underwriting_fee, legal_doc_prep_fee, desk_review_fee, small_balance_fee,
      feasibility_fee, construction_holdback, draw_fee,
      initial_loan_amount, purchase_price,
      property_street, property_city, property_state, property_zip,
      additional_fees, additional_fees_notes
    `)
    .eq('loan_id', loanId)
    .maybeSingle()

  const termSheetPdf = await renderTermSheetPdf({
    loan: {
      loan_type: loan.loan_type,
      loan_amount: loan.loan_amount,
      interest_rate: loan.interest_rate,
      term_months: loan.term_months,
      interest_only: loan.interest_only,
      arv: loan.arv,
      rehab_budget: loan.rehab_budget,
      entity_name: loan.entity_name,
      property_address: loan.property_address,
    },
    details: {
      rate_type: details?.rate_type ?? null,
      amortization_schedule: details?.amortization_schedule ?? null,
      prepayment_penalty: details?.prepayment_penalty ?? null,
      points: details?.points ?? null,
      broker_points: details?.broker_points ?? null,
      underwriting_fee: details?.underwriting_fee ?? null,
      legal_doc_prep_fee: details?.legal_doc_prep_fee ?? null,
      desk_review_fee: details?.desk_review_fee ?? null,
      small_balance_fee: details?.small_balance_fee ?? null,
      feasibility_fee: details?.feasibility_fee ?? null,
      construction_holdback: details?.construction_holdback ?? null,
      draw_fee: details?.draw_fee ?? null,
      initial_loan_amount: details?.initial_loan_amount ?? null,
      purchase_price: details?.purchase_price ?? null,
      property_street: details?.property_street ?? null,
      property_city: details?.property_city ?? null,
      property_state: details?.property_state ?? null,
      property_zip: details?.property_zip ?? null,
      additional_fees: details?.additional_fees ?? null,
      additional_fees_notes: details?.additional_fees_notes ?? null,
    },
    borrower,
    coBorrowerNames,
    esignTags: true,
    // Logo only on borrower-only loans — same branding rule as the
    // download/preview. The same-height spacer keeps the e-sign tag
    // positions identical whether the logo shows or not.
    showLogo: !(loan.broker_id || loan.broker_id_2),
  })

  // Term Sheet fields come from its rendered tags (extract BEFORE the
  // W-9 pages are appended; their page numbers stay valid).
  const termSheetFields = await extractTagFields(termSheetPdf)
  if (termSheetFields.length === 0) {
    return { error: 'Term Sheet rendered without signature tags.', status: 500 }
  }

  const w9 = getEsignForm('w9')
  if (!w9) return { error: 'W-9 form is not configured.', status: 500 }
  const w9Template = fs.readFileSync(path.join(process.cwd(), 'public', 'esign-forms', w9.file))
  const w9Values: Record<string, string> = Object.fromEntries(
    w9.fill.map(f => [f.key, f.defaultText ?? '']),
  )
  // Line 1: the vesting entity, or the borrower for individual loans.
  w9Values.line1_name = (loan.entity_name as string | null) ?? borrower?.full_name ?? ''

  const merged = await appendFormToPdf(termSheetPdf, w9, w9Template, w9Values)

  return {
    pdf: merged.pdf,
    fields: [...termSheetFields, ...merged.fields],
    borrower: { full_name: borrower?.full_name ?? null, email: borrower?.email ?? null },
    loanName: formatLoanName({
      borrowerName: borrower?.full_name ?? null,
      propertyAddress: loan.property_address,
    }),
  }
}
