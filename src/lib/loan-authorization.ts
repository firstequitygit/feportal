import { SupabaseClient } from '@supabase/supabase-js'

export type LoanRole =
  | { role: 'borrower'; borrowerId: string }
  | { role: 'loan_officer'; loanOfficerId: string }
  | { role: 'loan_processor'; loanProcessorId: string; isOpsManager: boolean }
  | { role: 'underwriter'; underwriterId: string }
  | { role: 'admin' }
  | null

/**
 * Resolves the caller's role on a specific loan. Returns null if the user
 * has no relationship to the loan.
 *
 * Pass the result of createAdminClient() so this can read role tables that
 * the authenticated client cannot.
 */
export async function getLoanRoleForUser(
  adminClient: SupabaseClient,
  loanId: string,
  userId: string,
): Promise<LoanRole> {
  const [{ data: admin }, { data: lo }, { data: lp }, { data: uw }, { data: borrower }] = await Promise.all([
    adminClient.from('admin_users').select('id, role').eq('auth_user_id', userId).maybeSingle(),
    adminClient.from('loan_officers').select('id').eq('auth_user_id', userId).maybeSingle(),
    adminClient.from('loan_processors').select('id, is_ops_manager').eq('auth_user_id', userId).maybeSingle(),
    adminClient.from('underwriters').select('id').eq('auth_user_id', userId).maybeSingle(),
    adminClient.from('borrowers').select('id').eq('auth_user_id', userId).maybeSingle(),
  ])

  if (admin?.role === 'admin') return { role: 'admin' }

  const { data: loan } = await adminClient
    .from('loans')
    .select('borrower_id, loan_officer_id, loan_processor_id, loan_processor_id_2, underwriter_id')
    .eq('id', loanId)
    .maybeSingle()
  if (!loan) return null

  if (borrower && loan.borrower_id === borrower.id) {
    return { role: 'borrower', borrowerId: borrower.id }
  }
  if (lo && loan.loan_officer_id === lo.id) {
    return { role: 'loan_officer', loanOfficerId: lo.id }
  }
  if (lp && (lp.is_ops_manager || loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) {
    return { role: 'loan_processor', loanProcessorId: lp.id, isOpsManager: !!lp.is_ops_manager }
  }
  if (uw && loan.underwriter_id === uw.id) {
    return { role: 'underwriter', underwriterId: uw.id }
  }
  return null
}

/** True if this role can bulk-upload to the loan. All current roles can. */
export function canBulkUpload(role: LoanRole): boolean {
  return role !== null
}

/** True if this role is internal staff (sees all unmatched docs on the loan). */
export function isStaff(role: LoanRole): boolean {
  if (!role) return false
  return role.role !== 'borrower'
}
