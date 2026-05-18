// One-off: create a new admin login. Creates the Supabase auth user with
// an admin-set temporary password, then inserts the admin_users row.
//
// Usage:
//   node scripts/create-admin.mjs <email> <"Full Name">
//
// Prints the generated temporary password — share it with the new admin
// out-of-band. They can change it after first login.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const email = process.argv[2]
const fullName = process.argv[3]
if (!email || !fullName) {
  console.error('Usage: node scripts/create-admin.mjs <email> <"Full Name">')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env vars'); process.exit(1) }

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// Generate a readable temp password: TwoWord-XXXXXXXX
const ADJECTIVES = ['Brisk', 'Calm', 'Eager', 'Quiet', 'Sharp', 'Steady', 'Swift', 'Vivid']
const NOUNS = ['Anchor', 'Beacon', 'Cedar', 'Drift', 'Ember', 'Falcon', 'Granite', 'Harbor']
const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const tempPassword = `${pick(ADJECTIVES)}${pick(NOUNS)}-${randomBytes(4).toString('hex')}`

// 1. Make sure they don't already exist
const { data: existingRow } = await admin
  .from('admin_users').select('id, auth_user_id').eq('email', email).maybeSingle()
if (existingRow) {
  console.error(`An admin_users row with email ${email} already exists (id=${existingRow.id}). Aborting.`)
  process.exit(1)
}

// 2. Create auth user with temp password, email pre-confirmed
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password: tempPassword,
  email_confirm: true,
  user_metadata: { full_name: fullName, role: 'admin' },
})
if (createErr) { console.error('Auth create failed:', createErr.message); process.exit(1) }

// 3. Insert admin_users row
const { error: rowErr } = await admin.from('admin_users').insert({
  auth_user_id: created.user.id,
  email,
  full_name: fullName,
  role: 'admin',
})
if (rowErr) {
  console.error('admin_users insert failed:', rowErr.message)
  // Clean up auth user if row insert failed
  await admin.auth.admin.deleteUser(created.user.id)
  console.error('Rolled back auth user.')
  process.exit(1)
}

console.log('')
console.log('✓ Admin created')
console.log('  Email:    ', email)
console.log('  Name:     ', fullName)
console.log('  Temp pw:  ', tempPassword)
console.log('  Auth ID:  ', created.user.id)
console.log('')
console.log('Share the temp password out-of-band. They can change it after sign-in.')
