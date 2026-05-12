'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import {
  CONDITION_CATEGORIES,
  type ConditionCategory,
  type ConditionStatus,
} from '@/lib/types'

type InboxRole = 'loan_officer' | 'loan_processor' | 'underwriter'

export interface InboxItem {
  id: string
  loan_id: string
  title: string
  description: string | null
  status: ConditionStatus
  category: ConditionCategory | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
  loan_address: string | null
  loan_stage: string | null
  loan_number: string | null
}

interface Props {
  items: InboxItem[]
  role: InboxRole
  linkPrefix: string
}

type CategoryFilter = 'all' | ConditionCategory

function ageInDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

function ageRefDate(item: InboxItem): string {
  return item.status === 'Outstanding' ? item.created_at : item.updated_at
}

function ageDotClass(days: number): string {
  if (days >= 7) return 'bg-red-500'
  if (days >= 3) return 'bg-yellow-500'
  return 'bg-gray-300'
}

function statusBadgeClass(status: ConditionStatus): string {
  switch (status) {
    case 'Outstanding': return 'bg-red-100 text-red-700'
    case 'Rejected':    return 'bg-orange-100 text-orange-700'
    case 'Received':    return 'bg-yellow-100 text-yellow-700'
    case 'Satisfied':   return 'bg-green-100 text-green-700'
    case 'Waived':      return 'bg-gray-100 text-gray-500'
  }
}

export function InboxView({ items, role, linkPrefix }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')

  // Underwriters review Received items, so they count as action needed for UW.
  // For LO/LP, Received means they marked something received and it's no longer their action.
  const isActionable = (status: ConditionStatus): boolean => {
    if (status === 'Outstanding' || status === 'Rejected') return true
    if (role === 'underwriter' && status === 'Received') return true
    return false
  }

  const actionableItems = useMemo(
    () => items.filter(i => isActionable(i.status)),
    [items, role], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const filtered = useMemo(() => {
    return actionableItems.filter(item => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      return true
    })
  }, [actionableItems, categoryFilter])

  const groups = useMemo(() => {
    const byLoan = new Map<string, {
      loan_address: string | null
      loan_stage: string | null
      loan_number: string | null
      items: InboxItem[]
      oldestDays: number
    }>()
    for (const item of filtered) {
      const days = ageInDays(ageRefDate(item))
      const existing = byLoan.get(item.loan_id)
      if (existing) {
        existing.items.push(item)
        existing.oldestDays = Math.max(existing.oldestDays, days)
      } else {
        byLoan.set(item.loan_id, {
          loan_address: item.loan_address,
          loan_stage: item.loan_stage,
          loan_number: item.loan_number,
          items: [item],
          oldestDays: days,
        })
      }
    }
    for (const g of byLoan.values()) {
      g.items.sort((a, b) => ageInDays(ageRefDate(b)) - ageInDays(ageRefDate(a)))
    }
    return Array.from(byLoan.entries())
      .map(([loan_id, g]) => ({ loan_id, ...g }))
      .sort((a, b) => b.oldestDays - a.oldestDays)
  }, [filtered])

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">
          Inbox
          <span className="ml-2 text-base font-normal text-gray-400">{actionableItems.length}</span>
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {role === 'underwriter'
            ? 'Conditions awaiting your review or action'
            : 'Conditions that need your action'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <FilterChip small active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
          All categories
        </FilterChip>
        {CONDITION_CATEGORIES.map(c => (
          <FilterChip
            key={c.value}
            small
            active={categoryFilter === c.value}
            onClick={() => setCategoryFilter(c.value)}
          >
            {c.label.replace(' Conditions', '')}
          </FilterChip>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-gray-900 font-medium">Nothing in your inbox.</p>
            <p className="text-sm text-gray-500 mt-1">
              {categoryFilter === 'all'
                ? "You're all caught up."
                : 'No items in this category.'}
            </p>
            <Link href={`${linkPrefix}/loans`} className="text-sm text-primary hover:opacity-80 mt-4 inline-block">
              View all your loans →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <Card key={g.loan_id} className="overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-3 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">
                    {g.loan_address ?? 'Unknown address'}
                  </p>
                  {g.loan_stage && (
                    <span className="text-xs text-gray-500 whitespace-nowrap">· {g.loan_stage}</span>
                  )}
                </div>
                <Link
                  href={`${linkPrefix}/loans/${g.loan_id}`}
                  className="text-xs text-primary hover:opacity-80 whitespace-nowrap font-medium"
                >
                  View loan →
                </Link>
              </div>
              <div className="divide-y divide-gray-100">
                {g.items.map(item => {
                  const days = ageInDays(ageRefDate(item))
                  return (
                    <Link
                      key={item.id}
                      href={`${linkPrefix}/loans/${item.loan_id}#cond-${item.id}`}
                      className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${ageDotClass(days)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                          <span className="text-xs text-gray-400 whitespace-nowrap">{days}d</span>
                        </div>
                        {item.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.description}</p>
                        )}
                        {item.status === 'Rejected' && item.rejection_reason && (
                          <p className="text-xs text-orange-600 mt-1 line-clamp-1">
                            Reason: {item.rejection_reason}
                          </p>
                        )}
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0 ${statusBadgeClass(item.status)}`}>
                        {item.status}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active, onClick, count, small, children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  small?: boolean
  children: React.ReactNode
}) {
  const size = small
    ? 'text-xs px-2.5 py-1'
    : 'text-sm px-3.5 py-1.5'
  const state = active
    ? 'bg-primary text-white border-primary'
    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${size} rounded-full font-medium border transition-colors ${state}`}
    >
      {children}
      {count !== undefined && (
        <span className={`ml-1.5 ${active ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
      )}
    </button>
  )
}
