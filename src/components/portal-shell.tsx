'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SyncButton } from '@/components/sync-button'
import { InviteBorrower } from '@/components/invite-borrower'
import { InviteBroker } from '@/components/invite-broker'
import {
  LayoutDashboard, LogOut, Menu, X,
  Users, UserCog, ShieldCheck, ClipboardList, Archive, FileCheck,
  Inbox, Building2, BarChart3,
} from 'lucide-react'

type Variant = 'default' | 'admin' | 'borrower' | 'broker' | 'loan-officer' | 'loan-processor' | 'underwriter'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

interface Props {
  userName: string | null
  userRole: string
  dashboardHref: string
  variant?: Variant
  maxWidth?: string
  children: React.ReactNode
}

const ADMIN_NAV: NavItem[] = [
  { href: '/admin',                  label: 'Overview',            icon: LayoutDashboard, exact: true },
  { href: '/admin/loan-officers',    label: 'Loan Officers',       icon: Users },
  { href: '/admin/loan-processors',  label: 'Loan Processors',     icon: UserCog },
  { href: '/admin/underwriters',     label: 'Underwriters',        icon: ShieldCheck },
  { href: '/admin/templates',        label: 'Condition Templates', icon: ClipboardList },
  { href: '/reports',                label: 'Reports',             icon: BarChart3 },
  { href: '/admin/archived',         label: 'Archived Loans',      icon: Archive },
]

const LO_NAV: NavItem[] = [
  { href: '/loan-officer/inbox',      label: 'Inbox',          icon: Inbox },
  { href: '/loan-officer/loans',      label: 'Loans',          icon: Building2 },
  { href: '/loan-officer/conditions', label: 'Conditions',     icon: FileCheck },
  { href: '/reports',                 label: 'Reports',        icon: BarChart3 },
  { href: '/loan-officer/archived',   label: 'Archived Loans', icon: Archive },
]

const LP_NAV: NavItem[] = [
  { href: '/loan-processor/inbox',      label: 'Inbox',               icon: Inbox },
  { href: '/loan-processor/loans',      label: 'Loans',               icon: Building2 },
  { href: '/loan-processor/conditions', label: 'Conditions',          icon: FileCheck },
  { href: '/loan-processor/templates',  label: 'Condition Templates', icon: ClipboardList },
  { href: '/reports',                   label: 'Reports',             icon: BarChart3 },
  { href: '/loan-processor/archived',   label: 'Archived Loans',      icon: Archive },
]

const UW_NAV: NavItem[] = [
  { href: '/underwriter/inbox',      label: 'Inbox',               icon: Inbox },
  { href: '/underwriter/loans',      label: 'Loans',               icon: Building2 },
  { href: '/underwriter/templates',  label: 'Condition Templates', icon: ClipboardList },
  { href: '/reports',                label: 'Reports',             icon: BarChart3 },
]

function navIsActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(item.href + '/')
}

export function PortalShell({
  userName,
  userRole,
  dashboardHref,
  variant = 'default',
  maxWidth = 'max-w-5xl',
  children,
}: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const displayName = userName ?? userRole
  const initials = displayName.trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Build nav items based on variant
  const navItems: NavItem[] =
    variant === 'admin'          ? ADMIN_NAV :
    variant === 'loan-officer'   ? LO_NAV :
    variant === 'loan-processor' ? LP_NAV :
    variant === 'underwriter'    ? UW_NAV :
    [{ href: dashboardHref, label: 'My Loans', icon: LayoutDashboard, exact: true }]

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Top bar — full width, logo top-right */}
      <header className="fixed top-0 left-0 right-0 h-14 flex items-center z-10" style={{ backgroundColor: '#FFF6EF', borderBottom: '1px solid #e8ddd6' }}>
        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(true)}
          className="md:hidden p-1.5 ml-3 rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Logo pushed to top-right */}
        <div className="ml-auto pr-5">
          <Link href={dashboardHref} className="flex items-center gap-2.5">
            <div className="text-right hidden sm:block">
              <p className="font-bold text-sm leading-tight tracking-tight text-gray-900">First Equity Funding</p>
              <p className="text-xs leading-tight mt-0.5 text-gray-500">Portal</p>
            </div>
            <Image src="/logo-symbol.png" alt="First Equity Funding" width={32} height={32} className="h-8 w-auto" />
          </Link>
        </div>
      </header>

      {/* Sidebar — extends fully to top of screen (behind top bar on left) */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-60 bg-white border-r border-gray-200 flex flex-col
        transition-transform duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
      `}>

        {/* Mobile close */}
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 p-1.5 rounded-md text-gray-400 hover:bg-gray-100 md:hidden"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>

        {/* User — sits at the very top of the sidebar */}
        <div className="px-4 py-4 border-b border-gray-100 mt-14 md:mt-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold flex-shrink-0 select-none">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{displayName}</p>
              <p className="text-xs text-gray-500 leading-tight mt-0.5">{userRole}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = navIsActive({ href, label, icon: Icon, exact }, pathname)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Role-specific action buttons (Sync / Invite). Borrower gets none. */}
        {(variant === 'admin' || variant === 'loan-officer' || variant === 'loan-processor' || variant === 'underwriter') && (
          <div className="px-3 pb-3 border-t border-gray-100 pt-3 flex flex-col items-start gap-2">
            <SyncButton />
            {variant === 'admin' && <InviteBorrower apiEndpoint="/api/invite" />}
            {variant === 'admin' && <InviteBroker apiEndpoint="/api/invite-broker" />}
            {variant === 'loan-officer' && <InviteBorrower apiEndpoint="/api/loan-officer/invite" />}
            {variant === 'loan-officer' && <InviteBroker apiEndpoint="/api/loan-officer/invite-broker" />}
            {variant === 'loan-processor' && <InviteBorrower apiEndpoint="/api/loan-processor/invite" />}
            {variant === 'loan-processor' && <InviteBroker apiEndpoint="/api/loan-processor/invite-broker" />}
          </div>
        )}

        {/* Sign out */}
        <div className="px-3 pb-6 pt-4">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors w-full"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="md:ml-60 min-h-screen bg-gray-50">
        <div className={`pt-20 md:pt-20 pb-8 ${maxWidth} mx-auto px-4 md:px-8`}>
          {children}
        </div>
      </main>
    </div>
  )
}
