import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Reporting auth + scoping helper.
 *
 * Each report runs the same lookup: who's logged in, what staff role do they
 * have, and which subset of loans are they allowed to report on?
 *
 * Returns:
 *  - role: 'admin' | 'loan_officer' | 'loan_processor' | 'underwriter'
 *  - userName: full name for display
 *  - dashboardHref: where to send them when they click the logo
 *  - shellVariant: portal-shell `variant` prop
 *  - loanScopeFilter: when applied to a Supabase query against `loans`, filters
 *                    to only the loans this user is allowed to see. Admins get
 *                    everything (no filter applied).
 *
 * Redirects to /login if the user is not a staff member.
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
}

export async function getReportContext(): Promise<ReportContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  const [
    { data: adminUser },
    { data: lo },
    { data: lp },
    { data: uw },
  ] = await Promise.all([
    adminClient.from('admin_users').select('id, full_name').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('loan_officers').select('id, full_name').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('loan_processors').select('id, full_name').eq('auth_user_id', user.id).maybeSingle(),
    adminClient.from('underwriters').select('id, full_name').eq('auth_user_id', user.id).maybeSingle(),
  ])

  if (adminUser) {
    return {
      role: 'admin',
      userName: adminUser.full_name ?? null,
      dashboardHref: '/admin',
      shellVariant: 'admin',
      loanScopeColumn: null,
      loanScopeId: null,
    }
  }
  if (lo) {
    return {
      role: 'loan_officer',
      userName: lo.full_name,
      dashboardHref: '/loan-officer/inbox',
      shellVariant: 'loan-officer',
      loanScopeColumn: 'loan_officer_id',
      loanScopeId: lo.id,
    }
  }
  if (lp) {
    return {
      role: 'loan_processor',
      userName: lp.full_name,
      dashboardHref: '/loan-processor/inbox',
      shellVariant: 'loan-processor',
      loanScopeColumn: 'loan_processor_id',
      loanScopeId: lp.id,
    }
  }
  if (uw) {
    return {
      role: 'underwriter',
      userName: uw.full_name,
      dashboardHref: '/underwriter/inbox',
      shellVariant: 'underwriter',
      loanScopeColumn: 'underwriter_id',
      loanScopeId: uw.id,
    }
  }

  // Borrower or unknown user — not allowed in /reports
  redirect('/dashboard')
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
