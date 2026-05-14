// One-off: change admin login email from OLD to NEW in Supabase auth + admin_users.
// Usage: node scripts/update-admin-email.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Load .env.local
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const OLD_EMAIL = 'ascovill@fefunding.com'
const NEW_EMAIL = 'info@irongateportals.com'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env vars'); process.exit(1) }

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// 1. Find the admin_users row by current email
const { data: adminRow, error: lookupErr } = await admin
  .from('admin_users')
  .select('id, auth_user_id, full_name, email')
  .eq('email', OLD_EMAIL)
  .single()

if (lookupErr || !adminRow) {
  console.error('No admin_users row with email', OLD_EMAIL, lookupErr)
  process.exit(1)
}
console.log('Found admin:', adminRow)

// 2. Update auth.users via Supabase Auth admin API
const { data: authUpdate, error: authErr } = await admin.auth.admin.updateUserById(
  adminRow.auth_user_id,
  { email: NEW_EMAIL, email_confirm: true }
)
if (authErr) { console.error('Auth update failed:', authErr); process.exit(1) }
console.log('Auth email updated:', authUpdate.user?.email)

// 3. Update admin_users.email
const { error: rowErr } = await admin
  .from('admin_users')
  .update({ email: NEW_EMAIL })
  .eq('id', adminRow.id)
if (rowErr) { console.error('admin_users update failed:', rowErr); process.exit(1) }

console.log(`Done. ${OLD_EMAIL} → ${NEW_EMAIL}`)
