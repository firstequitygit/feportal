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
 * Validates that a candidate staff id exists in the staff table matching
 * the assigned_to role. Used to confirm "Other" assignments — pinning a
 * condition to any staff member in the system, not just the loan's own
 * LO/LP/UW. Returns the candidate (or null on invalid/missing) so callers
 * can write it straight into the conditions row.
 */
export async function validateStaffIdExists(
  adminClient: AdminClient,
  assignedTo: AssignedTo,
  staffId: string | null | undefined,
): Promise<string | null> {
  if (!staffId || staffId === '') return null
  const table =
    assignedTo === 'loan_officer'   ? 'loan_officers'   :
    assignedTo === 'loan_processor' ? 'loan_processors' :
    assignedTo === 'underwriter'    ? 'underwriters'    :
    null
  if (!table) return null  // 'borrower' assignments never have a staff id.
  const { data } = await adminClient
    .from(table).select('id').eq('id', staffId).maybeSingle()
  return data?.id ?? null
}

export interface StaffDirectory {
  loan_officers: Array<{ id: string; full_name: string }>
  loan_processors: Array<{ id: string; full_name: string }>
  underwriters: Array<{ id: string; full_name: string }>
}

/**
 * Fetches the system-wide staff directory used to populate the "Other"
 * assignment dropdown on the condition-add forms. Includes every LO / LP /
 * UW, not just the loan's assigned ones.
 */
export async function fetchStaffDirectory(adminClient: AdminClient): Promise<StaffDirectory> {
  const [{ data: los }, { data: lps }, { data: uws }, { data: admins }] = await Promise.all([
    adminClient.from('loan_officers').select('id, full_name, auth_user_id').order('full_name'),
    adminClient.from('loan_processors').select('id, full_name, auth_user_id').order('full_name'),
    adminClient.from('underwriters').select('id, full_name, auth_user_id').order('full_name'),
    adminClient.from('admin_users').select('auth_user_id'),
  ])

  // Exclude staff rows whose auth user is also an admin — same human, two
  // hats, but the "Other" dropdown is for non-admin staff only.
  const adminAuthIds = new Set<string>(
    (admins ?? [])
      .map(a => (a as { auth_user_id: string | null }).auth_user_id)
      .filter((id): id is string => !!id)
  )
  function notAdmin(row: { auth_user_id: string | null }): boolean {
    return !row.auth_user_id || !adminAuthIds.has(row.auth_user_id)
  }
  const strip = (rows: Array<{ id: string; full_name: string; auth_user_id: string | null }>) =>
    rows.filter(notAdmin).map(r => ({ id: r.id, full_name: r.full_name }))

  return {
    loan_officers:   strip((los ?? []) as { id: string; full_name: string; auth_user_id: string | null }[]),
    loan_processors: strip((lps ?? []) as { id: string; full_name: string; auth_user_id: string | null }[]),
    underwriters:    strip((uws ?? []) as { id: string; full_name: string; auth_user_id: string | null }[]),
  }
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
