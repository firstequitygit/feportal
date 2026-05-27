'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, UserCog, ShieldCheck, UserCheck, Mail } from 'lucide-react'

interface Props {
  isSuperAdmin: boolean
}

interface SubItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface Section {
  title: string
  items: SubItem[]
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

const NOTIFICATIONS_SUBITEMS: SubItem[] = [
  { href: '/admin/settings/notifications', label: 'Application Inbox', icon: Mail },
]

export function SettingsSidebar({ isSuperAdmin }: Props) {
  const pathname = usePathname()
  const usersItems = isSuperAdmin ? [...USERS_SUBITEMS, ADMINS_SUBITEM] : USERS_SUBITEMS

  const sections: Section[] = [
    { title: 'Users', items: usersItems },
    { title: 'Notifications', items: NOTIFICATIONS_SUBITEMS },
  ]

  return (
    <nav className="w-56 shrink-0 border-r border-gray-200 pr-4">
      {sections.map((section, idx) => (
        <div key={section.title} className={idx > 0 ? 'mt-6' : ''}>
          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
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
      ))}
    </nav>
  )
}
