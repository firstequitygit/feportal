import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEffectiveStaffContext } from '@/lib/staff-context'

/**
 * Reporting auth + scoping helper.
 *
 * Resolves the visitor's *active* role context (honoring the admin/base
 * view-mode toggle from staff-context) and the loan scope they're allowed to
 * report on. Admins get everything; other roles see only loans assigned to
 * them. Redirects to /dashboard if the visitor isn't a staff_user.
 */

export type StaffRole = 'admin' | 'loan_officer' | 'loan_processor' | 'underwriter'

export interface ReportContext {
  role: StaffRole
  userName: string | null
  dashboardHref: string
  shellVariant: 'admin' | 'loan-officer' | 'loan-processor' | 'underwriter'
  /** Column name on `loans` to filter by, e.g. 'loan_officer_id'. Null for admin. */
  loanScopeColumn: 'loan_officer_id' | 'loan_processor_id' | 'underwriter_id' | null
  /** Value to filter loanScopeColumn against. Null for admin. */
  loanScopeId: string | null
  /** Admins only — when true, surface super-admin-only sidebar entries. */
  isSuperAdmin: boolean
}

export async function getReportContext(): Promise<ReportContext> {
  const ctx = await getEffectiveStaffContext()
  if (!ctx) redirect('/dashboard')

  const { staff_user, active_kind } = ctx

  if (active_kind === 'admin') {
    return {
      role: 'admin',
      userName: staff_user.full_name,
      dashboardHref: '/admin',
      shellVariant: 'admin',
      loanScopeColumn: null,
      loanScopeId: null,
      isSuperAdmin: staff_user.is_super,
    }
  }

  // Base-role view: look up the role-table id so reports can scope loans
  // to this person. The staff_user_id FK is backfilled by the staff identity
  // migration, so this lookup is the canonical seam.
  const adminClient = createAdminClient()

  if (active_kind === 'loan_officer') {
    const { data: lo } = await adminClient
      .from('loan_officers')
      .select('id, full_name')
      .eq('staff_user_id', staff_user.id)
      .maybeSingle()
    if (!lo) redirect('/dashboard')
    return {
      role: 'loan_officer',
      userName: lo.full_name ?? staff_user.full_name,
      dashboardHref: '/loan-officer/inbox',
      shellVariant: 'loan-officer',
      loanScopeColumn: 'loan_officer_id',
      loanScopeId: lo.id,
      isSuperAdmin: false,
    }
  }

  if (active_kind === 'loan_processor') {
    const { data: lp } = await adminClient
      .from('loan_processors')
      .select('id, full_name')
      .eq('staff_user_id', staff_user.id)
      .maybeSingle()
    if (!lp) redirect('/dashboard')
    return {
      role: 'loan_processor',
      userName: lp.full_name ?? staff_user.full_name,
      dashboardHref: '/loan-processor/inbox',
      shellVariant: 'loan-processor',
      loanScopeColumn: 'loan_processor_id',
      loanScopeId: lp.id,
      isSuperAdmin: false,
    }
  }

  // active_kind === 'underwriter'
  const { data: uw } = await adminClient
    .from('underwriters')
    .select('id, full_name')
    .eq('staff_user_id', staff_user.id)
    .maybeSingle()
  if (!uw) redirect('/dashboard')
  return {
    role: 'underwriter',
    userName: uw.full_name ?? staff_user.full_name,
    dashboardHref: '/underwriter/inbox',
    shellVariant: 'underwriter',
    loanScopeColumn: 'underwriter_id',
    loanScopeId: uw.id,
    isSuperAdmin: false,
  }
}

/**
 * Display label for a staff role, used in report headers.
 */
export function roleLabel(role: StaffRole): string {
  switch (role) {
    case 'admin':          return 'Administrator'
    case 'loan_officer':   return 'Loan Officer'
    case 'loan_processor': return 'Loan Processor'
    case 'underwriter':    return 'Underwriter'
  }
}

/**
 * Builds the loan-detail href for a given role + loan id, so report rows can
 * link straight into the staff loan page that role actually has access to.
 */
export function loanDetailHref(role: StaffRole, loanId: string): string {
  switch (role) {
    case 'admin':          return `/admin/loans/${loanId}`
    case 'loan_officer':   return `/loan-officer/loans/${loanId}`
    case 'loan_processor': return `/loan-processor/loans/${loanId}`
    case 'underwriter':    return `/underwriter/loans/${loanId}`
  }
}
