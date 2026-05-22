// Paginated fetches for borrower + broker assignment dropdowns.
//
// PostgREST caps any single SELECT at 1000 rows by default. The admin /
// LP / LO loan detail pages used to fetch every borrower in one shot
// (.from('borrowers').select(...)) and silently dropped anyone past the
// first 1000 rows — borrowers whose name sorted alphabetically below
// rows 1-1000 ("R…" in production) disappeared from the assignment
// dropdown. These helpers loop through every 1000-row page until the
// table is exhausted.

import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface BorrowerOption {
  id: string
  full_name: string
  email: string
}

export interface BrokerOption {
  id: string
  full_name: string | null
  email: string
  company_name: string | null
}

export async function fetchAllBorrowers(adminClient: AdminClient): Promise<BorrowerOption[]> {
  const out: BorrowerOption[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await adminClient
      .from('borrowers')
      .select('id, full_name, email')
      .order('full_name')
      .range(from, from + 999)
    if (error || !data) break
    out.push(...(data as BorrowerOption[]))
    if (data.length < 1000) break
  }
  return out
}

export async function fetchAllBrokers(adminClient: AdminClient): Promise<BrokerOption[]> {
  const out: BrokerOption[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await adminClient
      .from('brokers')
      .select('id, full_name, email, company_name')
      .order('full_name')
      .range(from, from + 999)
    if (error || !data) break
    out.push(...(data as BrokerOption[]))
    if (data.length < 1000) break
  }
  return out
}
