// Resolves the assigned LO's email from the loan_officers table at runtime.
// The application stores only the display name (data.primary.loan_officer_assigned);
// this lookup keeps notification routing always in sync with the portal's LO list
// without redeploying. "Other" and any unrecognized name resolve to null.

import { createAdminClient } from '@/lib/supabase/admin'

/** Resolve the assigned loan officer's email, or null when unknown/"Other"/unmapped. */
export async function resolveLoanOfficerEmail(name: string | null | undefined): Promise<string | null> {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed || trimmed === 'Other') return null
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('loan_officers')
      .select('email')
      .eq('full_name', trimmed)
      .maybeSingle()
    const email = (data?.email as string | null) ?? null
    return email && email.includes('@') ? email : null
  } catch {
    return null
  }
}
