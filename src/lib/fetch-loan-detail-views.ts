// Server-side fetch for the current staff user's saved Loan Details
// views, used by every loan detail page before rendering the card.
//
// Returns:
//   - views[]           — every view this user owns, default-first
//   - defaultViewId     — id of the default view (or null)
//   - initialHiddenSet  — Set<string> of field keys to hide on load,
//                         derived from the default view (empty if no
//                         default is set)
//
// The card itself is a client component that can switch active views
// after mount; the server-side pre-resolve just decides what to render
// before JS hydrates. Keeps the SSR pass close to what the user
// last picked.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface LoanDetailView {
  id: string
  name: string
  hidden_fields: string[]
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface LoanDetailViewBundle {
  views: LoanDetailView[]
  defaultViewId: string | null
  initialHiddenFields: string[]
}

export async function fetchLoanDetailViews(
  adminClient: SupabaseClient,
  authUserId: string,
): Promise<LoanDetailViewBundle> {
  const { data } = await adminClient
    .from('loan_detail_views')
    .select('id, name, hidden_fields, is_default, created_at, updated_at')
    .eq('user_id', authUserId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  const views = (data ?? []) as LoanDetailView[]
  const defaultView = views.find(v => v.is_default) ?? null
  return {
    views,
    defaultViewId: defaultView?.id ?? null,
    initialHiddenFields: defaultView?.hidden_fields ?? [],
  }
}
