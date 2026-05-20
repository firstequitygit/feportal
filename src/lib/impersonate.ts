// Admin-only "View as" impersonation helper.
//
// When an admin appends `?as_borrower=<id>` or `?as_broker=<id>` to a
// borrower or broker page URL, we render that page as if the admin were
// signed in as that user — same auth/access rules, same layout, same data.
//
// Non-admins setting the query param are ignored (returns null), so this
// can be wired up to public-looking URLs without becoming a vulnerability.
//
// The pages themselves opt in by calling resolveImpersonation() near the
// top, then using the returned id instead of looking up the role row by
// auth_user_id.

import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type ImpersonationKind = 'borrower' | 'broker'

export interface ImpersonationContext {
  kind: ImpersonationKind
  id: string
  /** Display name for the banner — set after the role row is loaded. */
  displayName?: string | null
}

/**
 * Returns the impersonation context if (a) the current auth user is an
 * admin AND (b) one of the impersonation query params is set.  Otherwise
 * null — the page should proceed with normal auth.
 */
export async function resolveImpersonation(
  supa: Admin,
  authUserId: string,
  searchParams: { [k: string]: string | string[] | undefined } | undefined,
): Promise<ImpersonationContext | null> {
  if (!searchParams) return null
  const asBorrower = pickString(searchParams.as_borrower)
  const asBroker   = pickString(searchParams.as_broker)
  if (!asBorrower && !asBroker) return null

  // Gate on admin — non-admins can't escalate by guessing the query param
  const { data: admin } = await supa
    .from('admin_users').select('id').eq('auth_user_id', authUserId).maybeSingle()
  if (!admin) return null

  if (asBorrower) return { kind: 'borrower', id: asBorrower }
  return { kind: 'broker', id: asBroker! }
}

function pickString(v: string | string[] | undefined): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

/**
 * Build the exit-link target — the path on the admin side the banner's
 * "Exit" button should send the user back to.  Defaults to /admin if we
 * don't have a more specific page in mind.
 */
export function impersonationExitHref(loanId?: string): string {
  return loanId ? `/admin/loans/${loanId}` : '/admin'
}
