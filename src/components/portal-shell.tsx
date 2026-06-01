import { getEffectiveStaffContext } from '@/lib/staff-context'
import { PortalShellClient } from './portal-shell-client'
import type { StaffContext } from '@/lib/types'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { countUnreadMentions, resolveRoleIdent } from '@/lib/fetch-mentions'

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

  // Unread @mention count for the sidebar badge on the Inbox nav item.
  // Only computed for the four roles that have an Inbox in their nav —
  // admin / borrower / broker variants don't render an Inbox item.
  let unreadMentions = 0
  const kindByVariant = mentionKindForVariant(props.variant)
  if (kindByVariant) {
    try {
      const supa = await createClient()
      const { data: { user } } = await supa.auth.getUser()
      if (user) {
        const adminClient = createAdminClient()
        const ident = await resolveRoleIdent(adminClient, user.id, kindByVariant)
        if (ident) unreadMentions = await countUnreadMentions(adminClient, ident)
      }
    } catch (err) {
      // Badge is best-effort. A failure here shouldn't keep the shell
      // from rendering — fall back to 0 (no badge shown).
      console.error('Unread-mentions count failed:', err instanceof Error ? err.message : err)
    }
  }

  return <PortalShellClient {...props} staffContext={staffContext} unreadMentions={unreadMentions} />
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
