// Loan-staff utilities — used by the condition routes when validating /
// emailing a "specific person" assignment.
//
// The condition's `assigned_to_staff_id` only makes sense in the context
// of the loan it lives on: an LP id is only valid if it occupies one of
// the loan's LP slots. These helpers do that validation against the
// authoritative `loans` row.

import type { createAdminClient } from '@/lib/supabase/admin'
import type { AssignedTo } from '@/lib/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface LoanStaff {
  loan_officer_id: string | null
  loan_processor_id: string | null
  loan_processor_id_2: string | null
  underwriter_id: string | null
}

/**
 * Fetch the staff-assignment slots on a loan. Used by the writing routes
 * to validate a specific-person condition assignment.
 */
export async function getLoanStaffSlots(
  adminClient: AdminClient,
  loanId: string,
): Promise<LoanStaff | null> {
  const { data } = await adminClient
    .from('loans')
    .select('loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
    .eq('id', loanId)
    .single()
  if (!data) return null
  return {
    loan_officer_id: data.loan_officer_id ?? null,
    loan_processor_id: data.loan_processor_id ?? null,
    loan_processor_id_2: data.loan_processor_id_2 ?? null,
    underwriter_id: data.underwriter_id ?? null,
  }
}

/**
 * Validates that a candidate staff id can be the specific-person target
 * for a condition with the given assigned_to role on this loan. Returns
 * the candidate (normalized to null on invalid) so callers can write it
 * directly into the conditions row.
 */
export function validateStaffIdForRole(
  assignedTo: AssignedTo,
  staffId: string | null | undefined,
  slots: LoanStaff,
): string | null {
  if (!staffId || staffId === '') return null
  if (assignedTo === 'loan_officer') {
    return staffId === slots.loan_officer_id ? staffId : null
  }
  if (assignedTo === 'loan_processor') {
    return staffId === slots.loan_processor_id || staffId === slots.loan_processor_id_2
      ? staffId : null
  }
  if (assignedTo === 'underwriter') {
    return staffId === slots.underwriter_id ? staffId : null
  }
  // 'borrower' assignments never have a staff id.
  return null
}

/**
 * Look up the staff row's name + email for the email-routing layer. Returns
 * null when the id doesn't resolve (e.g. the slot was reassigned between
 * write and send) — the caller should fall back to role-wide notification.
 */
export async function getStaffContact(
  adminClient: AdminClient,
  assignedTo: AssignedTo,
  staffId: string,
): Promise<{ full_name: string | null; email: string | null } | null> {
  const table =
    assignedTo === 'loan_officer'   ? 'loan_officers'   :
    assignedTo === 'loan_processor' ? 'loan_processors' :
    assignedTo === 'underwriter'    ? 'underwriters'    :
    null
  if (!table) return null
  const { data } = await adminClient
    .from(table)
    .select('full_name, email')
    .eq('id', staffId)
    .maybeSingle()
  return data ?? null
}
