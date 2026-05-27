'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, UserCog, ShieldCheck, UserCheck } from 'lucide-react'

interface Props {
  isSuperAdmin: boolean
}

interface SubItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

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

export function SettingsSidebar({ isSuperAdmin }: Props) {
  const pathname = usePathname()
  const subItems = isSuperAdmin ? [...USERS_SUBITEMS, ADMINS_SUBITEM] : USERS_SUBITEMS

  return (
    <nav className="w-56 shrink-0 border-r border-gray-200 pr-4">
      <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Users
      </div>
      <ul className="space-y-0.5">
        {subItems.map(({ href, label, icon: Icon }) => {
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
    </nav>
  )
}
