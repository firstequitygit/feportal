// "View as" impersonation helper. An admin / LO / LP can preview a loan as
// the assigned borrower or broker by appending `?as_borrower=<id>` or
// `?as_broker=<id>` to the URL.
//
// Who can impersonate:
//   - Admin   — anywhere (dashboard, broker home, any loan)
//   - LO / LP — only on a SPECIFIC loan page, AND only if they're assigned
//               to that loan, AND only for a borrower/broker actually on it
//
// Pages opt in by calling resolveImpersonation() near the top, then using
// the returned id (instead of looking up the role row by auth_user_id) plus
// the returned impersonatorRole for the "Exit preview" link.

import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type ImpersonationKind = 'borrower' | 'broker'
export type ImpersonatorRole = 'admin' | 'loan_officer' | 'loan_processor'

export interface ImpersonationContext {
  kind: ImpersonationKind
  id: string
  /** Who is doing the impersonating — drives the "Exit preview" target. */
  impersonatorRole: ImpersonatorRole
  /** Optional display name (set by callers after loading the role row). */
  displayName?: string | null
}

/**
 * @param loanIdForAccessCheck Required when LO/LP should be allowed to
 *   impersonate. Omit (admin-only) on dashboard and broker home, where
 *   there's no single loan to verify against.
 */
export async function resolveImpersonation(
  supa: Admin,
  authUserId: string,
  searchParams: { [k: string]: string | string[] | undefined } | undefined,
  options: { loanIdForAccessCheck?: string } = {},
): Promise<ImpersonationContext | null> {
  if (!searchParams) return null
  const asBorrower = pickString(searchParams.as_borrower)
  const asBroker   = pickString(searchParams.as_broker)
  if (!asBorrower && !asBroker) return null

  // Detect impersonator role. Admin always wins; otherwise only check
  // LO/LP if we have a loan to verify against.
  const { data: admin } = await supa
    .from('admin_users').select('id').eq('auth_user_id', authUserId).maybeSingle()

  let impersonatorRole: ImpersonatorRole | null = null
  if (admin) {
    impersonatorRole = 'admin'
  } else if (options.loanIdForAccessCheck) {
    const [{ data: lo }, { data: lp }] = await Promise.all([
      supa.from('loan_officers').select('id').eq('auth_user_id', authUserId).maybeSingle(),
      supa.from('loan_processors').select('id').eq('auth_user_id', authUserId).maybeSingle(),
    ])
    if (lo || lp) {
      const { data: loan } = await supa.from('loans')
        .select('id, loan_officer_id, loan_processor_id, loan_processor_id_2, borrower_id, borrower_id_2, borrower_id_3, borrower_id_4, broker_id, broker_id_2')
        .eq('id', options.loanIdForAccessCheck)
        .maybeSingle()
      if (loan) {
        // (a) Verify impersonator has access to the loan
        if (lo && loan.loan_officer_id === lo.id) impersonatorRole = 'loan_officer'
        else if (lp && (loan.loan_processor_id === lp.id || loan.loan_processor_id_2 === lp.id)) impersonatorRole = 'loan_processor'

        // (b) Verify the impersonated borrower/broker is actually on the loan
        if (impersonatorRole) {
          if (asBorrower) {
            const slots = [loan.borrower_id, loan.borrower_id_2, loan.borrower_id_3, loan.borrower_id_4]
            if (!slots.includes(asBorrower)) impersonatorRole = null
          } else if (asBroker) {
            const slots = [loan.broker_id, loan.broker_id_2]
            if (!slots.includes(asBroker)) impersonatorRole = null
          }
        }
      }
    }
  }

  if (!impersonatorRole) return null

  if (asBorrower) return { kind: 'borrower', id: asBorrower, impersonatorRole }
  return { kind: 'broker', id: asBroker!, impersonatorRole }
}

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

/**
 * Build the exit-link target — where the banner's "Exit preview" button
 * should send the impersonator back to. Routes to the impersonator's own
 * portal so they land back where they started.
 */
export function impersonationExitHref(
  loanId?: string,
  impersonatorRole: ImpersonatorRole = 'admin',
): string {
  if (!loanId) {
    // Dashboard / broker home — only admins reach here, so route to /admin.
    return '/admin'
  }
  switch (impersonatorRole) {
    case 'admin':          return `/admin/loans/${loanId}`
    case 'loan_officer':   return `/loan-officer/loans/${loanId}`
    case 'loan_processor': return `/loan-processor/loans/${loanId}`
  }
}
