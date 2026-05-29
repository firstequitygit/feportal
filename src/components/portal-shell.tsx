import { getEffectiveStaffContext } from '@/lib/staff-context'
import { PortalShellClient } from './portal-shell-client'
import type { StaffContext } from '@/lib/types'

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
  return <PortalShellClient {...props} staffContext={staffContext} />
}
