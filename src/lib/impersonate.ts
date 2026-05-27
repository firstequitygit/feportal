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
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { verifyViewAsCookie, VIEW_AS_COOKIE } from '@/lib/view-as-cookie'

type Admin = ReturnType<typeof createAdminClient>

export type ImpersonationKind =
  | 'borrower' | 'broker'
  | 'loan_officer' | 'loan_processor' | 'underwriter'
export type ImpersonatorRole = 'admin' | 'loan_officer' | 'loan_processor'

export interface ImpersonationContext {
  kind: ImpersonationKind
  id: string
  /** Who is doing the impersonating — drives the "Exit preview" target. */
  impersonatorRole: ImpersonatorRole
  /** Optional display name (set by callers after loading the role row). */
  displayName?: string | null
}

/** Query-param names mapped to the kind they signal. */
const KIND_PARAMS = {
  borrower:        'as_borrower',
  broker:          'as_broker',
  loan_officer:    'as_loan_officer',
  loan_processor:  'as_loan_processor',
  underwriter:     'as_underwriter',
} as const

/** Which kinds are restricted to admin impersonators only. */
const ADMIN_ONLY_KINDS: ImpersonationKind[] = ['loan_officer', 'loan_processor', 'underwriter']

/**
 * Read the signed view-as cookie, verify the admin still exists, and return
 * an ImpersonationContext. Returns null if cookie missing, invalid, or admin
 * no longer exists.
 */
export async function readImpersonationCookie(
  supa: Admin,
  authUserId: string,
): Promise<ImpersonationContext | null> {
  const c = await cookies()
  const payload = verifyViewAsCookie(c.get(VIEW_AS_COOKIE)?.value)
  if (!payload) return null
  // Cookie is bound to the admin who created it. Reject if the current
  // auth user is not that same admin (still in admin_users, still linked
  // to the same auth_user_id).
  const { data: admin } = await supa
    .from('admin_users')
    .select('id')
    .eq('id', payload.admin_id)
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (!admin) return null
  return {
    kind: payload.kind,
    id: payload.target_id,
    impersonatorRole: 'admin',
  }
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
  // New: cookie-based admin global picker takes precedence.
  const cookieCtx = await readImpersonationCookie(supa, authUserId)
  if (cookieCtx) return cookieCtx

  if (!searchParams) return null

  // Find which (if any) impersonation kind was requested.
  let requestedKind: ImpersonationKind | null = null
  let requestedId: string | null = null
  for (const [kind, param] of Object.entries(KIND_PARAMS) as [ImpersonationKind, string][]) {
    const v = pickString(searchParams[param])
    if (v) { requestedKind = kind; requestedId = v; break }
  }
  if (!requestedKind || !requestedId) return null

  // Detect impersonator role. Admin always wins; LO/LP only count when we
  // have a loan to verify access against AND the kind is borrower/broker.
  const { data: admin } = await supa
    .from('admin_users').select('id').eq('auth_user_id', authUserId).maybeSingle()

  let impersonatorRole: ImpersonatorRole | null = null
  if (admin) {
    impersonatorRole = 'admin'
  } else if (
    options.loanIdForAccessCheck &&
    !ADMIN_ONLY_KINDS.includes(requestedKind)
  ) {
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
          if (requestedKind === 'borrower') {
            const slots = [loan.borrower_id, loan.borrower_id_2, loan.borrower_id_3, loan.borrower_id_4]
            if (!slots.includes(requestedId)) impersonatorRole = null
          } else if (requestedKind === 'broker') {
            const slots = [loan.broker_id, loan.broker_id_2]
            if (!slots.includes(requestedId)) impersonatorRole = null
          }
        }
      }
    }
  }

  if (!impersonatorRole) return null
  return { kind: requestedKind, id: requestedId, impersonatorRole }
}

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

/**
 * For mutation API routes. Returns a 403 NextResponse if the request is
 * coming from an active View-As session; otherwise returns null and the
 * route proceeds normally.
 */
export async function assertNotImpersonating(): Promise<NextResponse | null> {
  const c = await cookies()
  if (c.get(VIEW_AS_COOKIE)) {
    return NextResponse.json(
      { error: 'Read-only preview: exit View As to make changes.' },
      { status: 403 }
    )
  }
  return null
}

const ROLE_TABLE = {
  loan_officer:   'loan_officers',
  loan_processor: 'loan_processors',
  underwriter:    'underwriters',
} as const

/**
 * For LO/LP/UW role home pages. If the view-as cookie targets this role,
 * returns that target's row. Otherwise returns the auth user's own role row.
 */
export async function getEffectiveRoleRow<T extends Record<string, unknown> = Record<string, unknown>>(
  supa: Admin,
  kind: 'loan_officer' | 'loan_processor' | 'underwriter',
  authUserId: string,
): Promise<T | null> {
  const ctx = await readImpersonationCookie(supa, authUserId)
  if (ctx?.kind === kind) {
    const { data } = await supa.from(ROLE_TABLE[kind]).select('*').eq('id', ctx.id).maybeSingle()
    return (data ?? null) as T | null
  }
  const { data } = await supa.from(ROLE_TABLE[kind]).select('*').eq('auth_user_id', authUserId).maybeSingle()
  return (data ?? null) as T | null
}

/**
 * Build the exit-link target -- where the banner's "Exit preview" button
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
