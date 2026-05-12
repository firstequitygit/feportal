'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Subscribe to Supabase Realtime changes for a specific loan and trigger
 * router.refresh() when conditions, documents, loan_notes, loan_events,
 * or the loan row itself changes. Returns null — pure side effect.
 *
 * Requires the relevant tables to be added to the realtime publication:
 *   ALTER PUBLICATION supabase_realtime ADD TABLE conditions, documents,
 *     loan_notes, loan_events, loans;
 */
export function LoanRealtimeRefresh({ loanId }: { loanId: string }) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    const refresh = () => router.refresh()

    const channel = supabase
      .channel(`loan-${loanId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conditions',  filter: `loan_id=eq.${loanId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents',   filter: `loan_id=eq.${loanId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_notes',  filter: `loan_id=eq.${loanId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_events', filter: `loan_id=eq.${loanId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'loans',  filter: `id=eq.${loanId}` }, refresh)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loanId, router])

  return null
}
