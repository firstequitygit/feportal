'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SyncButton } from '@/components/sync-button'
import { AirtableSyncButton } from '@/components/airtable-sync-button'
import { InviteBorrower } from '@/components/invite-borrower'
import { InviteBroker } from '@/components/invite-broker'
import { AdminViewAsTrigger } from '@/components/admin-view-as-trigger'
import { ImpersonationProvider } from '@/components/impersonation-provider'
import {
  LayoutDashboard, LogOut, Menu, X, Pin, PinOff,
  Users, UserCog, ShieldCheck, ClipboardList, Archive, FileCheck,
  Inbox, Building2, BarChart3, UserCircle, Briefcase, Store, Settings, Eye,
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
  /** Admin only: when true, surface the super-admin-only nav items (Admins). */
  isSuperAdmin?: boolean
  /** When set, render the "Viewing as X / Exit" header pill and wrap children
   *  in ImpersonationProvider with isImpersonating=true. When null/undefined
   *  on the admin variant, the "View as" trigger button is rendered instead. */
  impersonation?: {
    kind: 'borrower' | 'broker' | 'loan_officer' | 'loan_processor' | 'underwriter'
    name: string | null
    exitHref: string
  } | null
  children: React.ReactNode
}

const IMPERSONATION_KIND_LABEL = {
  borrower:       'Borrower',
  broker:         'Broker',
  loan_officer:   'Loan Officer',
  loan_processor: 'Loan Processor',
  underwriter:    'Underwriter',
} as const

const ADMIN_NAV: NavItem[] = [
  { href: '/admin',                  label: 'Overview',            icon: LayoutDashboard, exact: true },
  { href: '/admin/borrowers',        label: 'Borrowers',           icon: UserCircle },
  { href: '/admin/brokers',          label: 'Brokers',             icon: Briefcase },
  { href: '/admin/templates',        label: 'Condition Templates', icon: ClipboardList },
  { href: '/reports',                label: 'Reports',             icon: BarChart3 },
  { href: '/admin/archived',         label: 'Archived Loans',      icon: Archive },
  { href: '/admin/settings',         label: 'Settings',            icon: Settings },
]

const LO_NAV: NavItem[] = [
  { href: '/loan-officer/inbox',      label: 'Inbox',          icon: Inbox },
  { href: '/loan-officer/loans',      label: 'Loans',          icon: Building2 },
  { href: '/loan-officer/conditions', label: 'Conditions',     icon: FileCheck },
  { href: '/loan-officer/borrowers',  label: 'Borrowers',      icon: UserCircle },
  { href: '/loan-officer/brokers',    label: 'Brokers',        icon: Briefcase },
  { href: '/loan-officer/vendors',    label: 'Vendors',        icon: Store },
  { href: '/reports',                 label: 'Reports',        icon: BarChart3 },
  { href: '/loan-officer/archived',   label: 'Archived Loans', icon: Archive },
]

const LP_NAV: NavItem[] = [
  { href: '/loan-processor/inbox',      label: 'Inbox',               icon: Inbox },
  { href: '/loan-processor/loans',      label: 'Loans',               icon: Building2 },
  { href: '/loan-processor/conditions', label: 'Conditions',          icon: FileCheck },
  { href: '/loan-processor/borrowers',  label: 'Borrowers',           icon: UserCircle },
  { href: '/loan-processor/brokers',    label: 'Brokers',             icon: Briefcase },
  { href: '/loan-processor/vendors',    label: 'Vendors',             icon: Store },
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
  // kept for back-compat; settings shell handles super-admin nav now
  isSuperAdmin = false,
  impersonation,
  children,
}: Props) {
  const showViewAsTrigger = variant === 'admin' && !impersonation
  const [open, setOpen] = useState(false)          // mobile drawer (unchanged)
  const [pinned, setPinned] = useState(true)       // desktop pin; default = today's look
  const [mouseOver, setMouseOver] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const expanded = pinned || mouseOver || focusWithin
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  // Restore the user's last pinned/collapsed choice. localStorage is unavailable
  // during SSR, so read after mount (mirrors the DataGrid persistence pattern).
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar:pinned')
      if (saved !== null) setPinned(JSON.parse(saved) as boolean)
    } catch { /* ignore corrupt storage */ }
  }, [])

  function togglePinned() {
    setPinned(prev => {
      const next = !prev
      try { localStorage.setItem('sidebar:pinned', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const displayName = (userName ?? userRole).replace(/\s*\(Admin\)\s*$/, '')
  const initials = displayName.trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

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
      <header className="fixed top-0 left-0 right-0 h-14 flex items-center z-10 bg-white border-b border-gray-200">
        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(true)}
          className="md:hidden p-1.5 ml-3 rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Persistent header slot: impersonation pill > "View as" trigger > nothing.
            The pill is the source of truth for "currently impersonating" — it
            replaces the body banner so the indicator + exit live in one fixed
            location across every page. */}
        <div className="ml-auto mr-3">
          {impersonation ? (
            <button
              type="button"
              onClick={async () => {
                // POST clears the cookie when present; harmless no-op for
                // URL-based impersonation (no cookie to clear). Then navigate
                // to the page-supplied exitHref (strips any ?as_* params).
                try { await fetch('/api/admin/view-as/exit', { method: 'POST' }) } catch { /* ignore */ }
                router.push(impersonation.exitHref)
                router.refresh()
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-900 border border-amber-300 rounded-md hover:bg-amber-200"
              title="Exit View As preview"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>
                Viewing as <strong>{IMPERSONATION_KIND_LABEL[impersonation.kind]}{impersonation.name ? ` · ${impersonation.name}` : ''}</strong>
              </span>
              <X className="w-3.5 h-3.5" />
            </button>
          ) : showViewAsTrigger ? (
            <AdminViewAsTrigger />
          ) : null}
        </div>
        <div className="pr-5">
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
      <aside
        onMouseEnter={() => setMouseOver(true)}
        onMouseLeave={() => setMouseOver(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusWithin(false) }}
        className={`
        fixed inset-y-0 left-0 z-30 w-60 bg-white border-r border-gray-200 flex flex-col
        transition-all duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
        ${expanded ? 'md:w-60' : 'md:w-16'}
        ${!pinned && expanded ? 'md:shadow-xl' : ''}
      `}>

        {/* Mobile close */}
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 p-1.5 rounded-md text-gray-400 hover:bg-gray-100 md:hidden"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>

        {/* User + desktop pin toggle — top section, height matches the top bar so their borders align */}
        <div className="px-3 h-14 flex items-center border-b border-gray-100 mt-14 md:mt-0">
          <div className={`flex items-center w-full ${expanded ? 'gap-3' : 'md:justify-center'}`}>
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold flex-shrink-0 select-none">
              {initials}
            </div>
            <div className={`min-w-0 flex-1 ${!expanded ? 'md:hidden' : ''}`}>
              <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{displayName}</p>
              <p className="text-xs text-gray-500 leading-tight mt-0.5">{userRole}</p>
            </div>
            {expanded && (
              <button
                onClick={togglePinned}
                className="hidden md:inline-flex p-1 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex-shrink-0"
                aria-label={pinned ? 'Collapse sidebar' : 'Pin sidebar open'}
                title={pinned ? 'Collapse sidebar' : 'Pin sidebar open'}
              >
                {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              </button>
            )}
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
                className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                } ${expanded ? 'px-3' : 'px-3 md:justify-center md:px-0'}`}
                title={!expanded ? label : undefined}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className={!expanded ? 'md:hidden' : ''}>{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Role-specific action buttons (Sync / Invite). Borrower gets none. */}
        {(variant === 'admin' || variant === 'loan-officer' || variant === 'loan-processor' || variant === 'underwriter') && (
          <div className={`px-3 pb-3 border-t border-gray-100 pt-3 flex flex-col gap-2 ${expanded ? 'items-start' : 'items-start md:items-center'}`}>
            <SyncButton collapsed={!expanded} />
            {variant === 'admin' && <AirtableSyncButton collapsed={!expanded} />}
            {variant === 'admin' && <InviteBorrower apiEndpoint="/api/invite" collapsed={!expanded} />}
            {variant === 'admin' && <InviteBroker apiEndpoint="/api/invite-broker" collapsed={!expanded} />}
            {variant === 'loan-officer' && <InviteBorrower apiEndpoint="/api/loan-officer/invite" collapsed={!expanded} />}
            {variant === 'loan-officer' && <InviteBroker apiEndpoint="/api/loan-officer/invite-broker" collapsed={!expanded} />}
            {variant === 'loan-processor' && <InviteBorrower apiEndpoint="/api/loan-processor/invite" collapsed={!expanded} />}
            {variant === 'loan-processor' && <InviteBroker apiEndpoint="/api/loan-processor/invite-broker" collapsed={!expanded} />}
          </div>
        )}

        {/* Sign out */}
        <div className="px-3 pb-6 pt-4">
          <button
            onClick={handleLogout}
            className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors w-full ${expanded ? 'px-3' : 'px-3 md:justify-center md:px-0'}`}
            title={!expanded ? 'Sign out' : undefined}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className={!expanded ? 'md:hidden' : ''}>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className={`min-h-screen bg-gray-50 transition-all duration-200 ${pinned ? 'md:ml-60' : 'md:ml-16'}`}>
        <div className={`pt-20 md:pt-20 pb-8 ${maxWidth} mx-auto px-4 md:px-8`}>
          <ImpersonationProvider value={{ isImpersonating: !!impersonation }}>
            {children}
          </ImpersonationProvider>
        </div>
      </main>
    </div>
  )
}
