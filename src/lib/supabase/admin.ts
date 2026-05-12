import { createClient } from '@supabase/supabase-js'

// Direct service-role client for use in API routes (no cookies needed)
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
