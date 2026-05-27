'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem,
} from '@/components/ui/command'
import type { ViewAsKind } from '@/lib/view-as-cookie'

interface Person { id: string; full_name: string | null; email: string | null; company_name?: string | null }
interface PeopleData {
  loan_officers: Person[]; loan_processors: Person[]
  underwriters: Person[]; brokers: Person[]
}

interface Props { open: boolean; onOpenChange: (open: boolean) => void }

export function AdminViewAsModal({ open, onOpenChange }: Props) {
  const router = useRouter()
  const [people, setPeople] = useState<PeopleData | null>(null)
  const [query, setQuery] = useState('')
  const [borrowers, setBorrowers] = useState<Person[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open || people) return
    fetch('/api/admin/view-as/people')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setPeople(d) })
  }, [open, people])

  useEffect(() => {
    if (!open || query.trim().length < 1) { setBorrowers([]); return }
    const handle = setTimeout(() => {
      fetch(`/api/admin/view-as/search?kind=borrower&q=${encodeURIComponent(query.trim())}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.results) setBorrowers(d.results) })
    }, 200)
    return () => clearTimeout(handle)
  }, [open, query])

  async function pick(kind: ViewAsKind, id: string) {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/view-as/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id }),
      })
      if (!res.ok) { setSubmitting(false); return }
      const { redirectTo } = await res.json() as { redirectTo: string }
      onOpenChange(false)
      router.push(redirectTo)
    } catch {
      setSubmitting(false)
    }
  }

  const groups = useMemo(() => people ? [
    { kind: 'loan_officer'   as const, label: 'Loan Officers',   rows: people.loan_officers },
    { kind: 'loan_processor' as const, label: 'Loan Processors', rows: people.loan_processors },
    { kind: 'underwriter'    as const, label: 'Underwriters',    rows: people.underwriters },
    { kind: 'broker'         as const, label: 'Brokers',         rows: people.brokers },
  ] : [], [people])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search people to view as..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No people found.</CommandEmpty>
        {groups.map(g => g.rows.length > 0 && (
          <CommandGroup key={g.kind} heading={g.label}>
            {g.rows.map(p => (
              <CommandItem
                key={`${g.kind}-${p.id}`}
                value={`${g.label} ${p.full_name ?? ''} ${p.email ?? ''} ${p.company_name ?? ''}`}
                onSelect={() => pick(g.kind, p.id)}
              >
                <div className="flex flex-col">
                  <span>{p.full_name ?? '(no name)'}</span>
                  <span className="text-xs text-gray-500">
                    {p.email}{p.company_name ? ` · ${p.company_name}` : ''}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {borrowers.length > 0 && (
          <CommandGroup heading="Borrowers">
            {borrowers.map(p => (
              <CommandItem
                key={`borrower-${p.id}`}
                value={`Borrower ${p.full_name ?? ''} ${p.email ?? ''}`}
                onSelect={() => pick('borrower', p.id)}
              >
                <div className="flex flex-col">
                  <span>{p.full_name ?? '(no name)'}</span>
                  <span className="text-xs text-gray-500">{p.email}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
