'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, UserCog, ShieldCheck, UserCheck, Settings } from 'lucide-react'

interface Props {
  isSuperAdmin: boolean
}

interface SubItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const GENERAL_SUBITEMS: SubItem[] = [
  { href: '/admin/settings/general', label: 'General', icon: Settings },
]

const USERS_SUBITEMS: SubItem[] = [
  { href: '/admin/settings/users/loan-officers',    label: 'Loan Officers',    icon: Users },
  { href: '/admin/settings/users/loan-processors',  label: 'Loan Processors',  icon: UserCog },
  { href: '/admin/settings/users/underwriters',     label: 'Underwriters',     icon: UserCheck },
]

const ADMINS_SUBITEM: SubItem = {
  href: '/admin/settings/users/admins',
  label: 'Admins',
  icon: ShieldCheck,
}

function NavSection({ heading, items, pathname }: { heading: string; items: SubItem[]; pathname: string }) {
  return (
    <div className="mb-4">
      <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {heading}
      </div>
      <ul className="space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function SettingsSidebar({ isSuperAdmin }: Props) {
  const pathname = usePathname()
  const userSubItems = isSuperAdmin ? [...USERS_SUBITEMS, ADMINS_SUBITEM] : USERS_SUBITEMS

  return (
    <nav className="w-56 shrink-0 border-r border-gray-200 pr-4">
      {isSuperAdmin && <NavSection heading="General" items={GENERAL_SUBITEMS} pathname={pathname} />}
      <NavSection heading="Users" items={userSubItems} pathname={pathname} />
    </nav>
  )
}
