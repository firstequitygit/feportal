// Shared "loan context" HTML snippet for notification emails.
//
// Every staff-facing notification (condition created, condition received,
// reassigned, mention, notify-UW, stage transition, etc.) gets this two-row
// block injected near the top of the message so the recipient can identify
// the borrower and the LO at a glance — no need to click into the portal to
// figure out "which Adam Scovill loan is this?".
//
// Two helpers:
//   fetchLoanEmailContext  → server-side fetch of the borrower + LO names
//                            for a given loanId. Always also returns the
//                            property_address so callers that don't have
//                            it can pull it from the same query.
//   loanContextBlockHtml   → renders the inline table snippet using whatever
//                            context the caller supplies. Skips rows whose
//                            value is null so we never show a "Borrower —"
//                            placeholder.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface LoanEmailContext {
  propertyAddress: string | null
  borrowerName: string | null
  loanOfficerName: string | null
}

type AdminClient = SupabaseClient

export async function fetchLoanEmailContext(
  adminClient: AdminClient,
  loanId: string,
): Promise<LoanEmailContext> {
  const { data } = await adminClient
    .from('loans')
    .select('property_address, borrowers!borrower_id(full_name), loan_officers!loan_officer_id(full_name)')
    .eq('id', loanId)
    .single()
  const row = data as unknown as {
    property_address: string | null
    borrowers?: { full_name: string | null } | null
    loan_officers?: { full_name: string | null } | null
  } | null
  return {
    propertyAddress: row?.property_address ?? null,
    borrowerName:    row?.borrowers?.full_name ?? null,
    loanOfficerName: row?.loan_officers?.full_name ?? null,
  }
}

/**
 * Returns the inline-table snippet. Designed to drop in directly under the
 * lead paragraph of any notification email. Empty when both borrower and
 * loan-officer are null (rare — just a stage 0 New Application with neither
 * resolved yet).
 */
export function loanContextBlockHtml(ctx: { borrowerName: string | null; loanOfficerName: string | null }): string {
  const rows: string[] = []
  if (ctx.borrowerName) {
    rows.push(`<tr><td style="padding: 4px 16px 4px 0; color: #666;">Borrower</td><td>${escapeHtml(ctx.borrowerName)}</td></tr>`)
  }
  if (ctx.loanOfficerName) {
    rows.push(`<tr><td style="padding: 4px 16px 4px 0; color: #666;">Loan Officer</td><td>${escapeHtml(ctx.loanOfficerName)}</td></tr>`)
  }
  if (rows.length === 0) return ''
  return `<table style="font-family: Arial, sans-serif; font-size: 14px; color: #333; border-collapse: collapse; margin-top: 12px;">${rows.join('')}</table>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
