import { getEffectiveStaffContext } from '@/lib/staff-context'
import { PortalShellClient } from './portal-shell-client'
import type { StaffContext } from '@/lib/types'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { countUnreadMentions, resolveRoleIdent } from '@/lib/fetch-mentions'
import { countOutstandingForRole } from '@/lib/fetch-outstanding-count'
import { resolveAdminIdentities, staffRoleIds, mentionIdents, countPinnedOutstanding } from '@/lib/admin-inbox'

// Server Component wrapper. Fetches StaffContext once on every render so the
// admin/base toggle in the header is available on every page that uses
// PortalShell, without per-page wiring. Pages that already need StaffContext
// for their own auth gate (e.g., /admin, /loan-officer/loans) may pass it in
// to avoid a second query; otherwise the wrapper fetches it.

interface PortalShellProps {
  userName: string | null
  userRole: string
  dashboardHref: string
  variant?: 'default' | 'admin' | 'borrower' | 'broker' | 'loan-officer' | 'loan-processor' | 'underwriter'
  maxWidth?: string
  isSuperAdmin?: boolean
  impersonation?: {
    kind: 'borrower' | 'broker' | 'loan_officer' | 'loan_processor' | 'underwriter'
    name: string | null
    exitHref: string
  } | null
  staffContext?: StaffContext | null
  children: React.ReactNode
}

export async function PortalShell(props: PortalShellProps) {
  const staffContext =
    props.staffContext !== undefined
      ? props.staffContext
      : await getEffectiveStaffContext()

  // Sidebar Inbox badge — sums two streams:
  //   1. Unread @mentions for this role identity
  //   2. Outstanding-for-you conditions (same definition as the dashboard
  //      tile of the same name)
  // Computed for the three role variants and for admin (whose Inbox is
  // the personal pinned-conditions queue); borrower / broker variants
  // render no Inbox.
  let unreadMentions = 0
  let outstandingForYou = 0
  const kindByVariant = mentionKindForVariant(props.variant)
  if (props.variant === 'admin') {
    try {
      const supa = await createClient()
      const { data: { user } } = await supa.auth.getUser()
      if (user) {
        const adminClient = createAdminClient()
        const ids = await resolveAdminIdentities(adminClient, user.id)
        if (ids.admin) {
          // Mentions across every identity the caller owns, plus
          // conditions pinned to them by name — same scope as
          // /admin/inbox.
          const [mentionCounts, pinned] = await Promise.all([
            Promise.all(mentionIdents(ids).map(i => countUnreadMentions(adminClient, i))),
            countPinnedOutstanding(adminClient, staffRoleIds(ids)),
          ])
          unreadMentions = mentionCounts.reduce((a, b) => a + b, 0)
          outstandingForYou = pinned
        }
      }
    } catch (err) {
      console.error('Inbox badge count failed:', err instanceof Error ? err.message : err)
    }
  } else if (kindByVariant) {
    try {
      const supa = await createClient()
      const { data: { user } } = await supa.auth.getUser()
      if (user) {
        const adminClient = createAdminClient()
        const ident = await resolveRoleIdent(adminClient, user.id, kindByVariant)
        if (ident) {
          // Ops manager LPs see the whole pipeline and also act as
          // closer — extend the badge to match the LP Inbox page's
          // scope. (Omayra is the only ops manager today.)
          let isOpsManagerLp = false
          if (kindByVariant === 'loan_processor') {
            const { data: lpRow } = await adminClient
              .from('loan_processors')
              .select('is_ops_manager')
              .eq('id', ident.id)
              .maybeSingle()
            isOpsManagerLp = !!lpRow?.is_ops_manager
          }
          // Both queries are independent — run in parallel.
          const [m, o] = await Promise.all([
            countUnreadMentions(adminClient, ident),
            countOutstandingForRole(adminClient, kindByVariant, ident.id, {
              allLoans: isOpsManagerLp,
              includeCloser: isOpsManagerLp,
            }),
          ])
          unreadMentions = m
          outstandingForYou = o
        }
      }
    } catch (err) {
      // Badge is best-effort. A failure here shouldn't keep the shell
      // from rendering — fall back to 0 (no badge shown).
      console.error('Inbox badge count failed:', err instanceof Error ? err.message : err)
    }
  }

  return (
    <PortalShellClient
      {...props}
      staffContext={staffContext}
      unreadMentions={unreadMentions}
      outstandingForYou={outstandingForYou}
    />
  )
}

function mentionKindForVariant(
  variant: PortalShellProps['variant'],
): 'loan_officer' | 'loan_processor' | 'underwriter' | null {
  switch (variant) {
    case 'loan-officer':   return 'loan_officer'
    case 'loan-processor': return 'loan_processor'
    case 'underwriter':    return 'underwriter'
    default:               return null
  }
}
