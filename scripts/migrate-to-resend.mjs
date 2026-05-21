// One-off: migrate every nodemailer call site to sendEmail() from
// @/lib/mailer. forgot-password was migrated separately on the auth
// branch (sendAuthEmail from @/lib/emails/send) — leave it alone here.

import { readFileSync, writeFileSync } from 'node:fs'

const FILES = [
  'src/app/api/admin/conditions/route.ts',
  'src/app/api/admin/loan-officers/invite/route.ts',
  'src/app/api/admin/loan-processors/invite/route.ts',
  'src/app/api/admin/underwriters/invite/route.ts',
  'src/app/api/admin/upload/record/route.ts',
  'src/app/api/loan-officer/conditions/route.ts',
  'src/app/api/loan-officer/upload/record/route.ts',
  'src/app/api/loan-processor/conditions/route.ts',
  'src/app/api/loan-processor/upload/record/route.ts',
  'src/app/api/loans/conditions/response/route.ts',
  'src/app/api/loans/field/route.ts',
  'src/app/api/loans/upload/record/route.ts',
  'src/app/api/underwriter/conditions/route.ts',
  'src/app/api/underwriter/upload/record/route.ts',
  'src/lib/invite-borrower.ts',
  'src/lib/invite-broker.ts',
]

let total = 0
for (const f of FILES) {
  const orig = readFileSync(f, 'utf8')
  let c = orig

  c = c.replace(/^import nodemailer from ['"]nodemailer['"]\r?\n/gm, '')
  c = c.replace(
    /\n?function getTransporter\(\) \{\s*\r?\n\s*return nodemailer\.createTransport\(\{[\s\S]*?\}\)\s*\r?\n\}\s*\r?\n/g,
    '\n',
  )
  c = c.replace(
    /\n?\s*const transporter = nodemailer\.createTransport\(\{[^}]*?(?:\{[^}]*\}[^}]*?)*\}\)\s*\r?\n/g,
    '\n',
  )
  c = c.replace(/\n\s*const gmailUser = process\.env\.GMAIL_USER\s*\r?\n/g, '\n')
  c = c.replace(/\n\s*const gmailPass = process\.env\.GMAIL_APP_PASSWORD\s*\r?\n/g, '\n')
  c = c.replace(/\n\s*const user = process\.env\.GMAIL_USER\s*\r?\n/g, '\n')
  c = c.replace(/\n\s*const pass = process\.env\.GMAIL_APP_PASSWORD\s*\r?\n/g, '\n')
  c = c.replace(/\n\s*if \(!gmailUser \|\| !gmailPass\) \{[^}]*\}\s*\r?\n/g, '\n')
  c = c.replace(/\n\s*if \(!user \|\| !pass\) \{[^}]*\}\s*\r?\n/g, '\n')

  c = c.replace(/\bgetTransporter\(\)\.sendMail\(/g, 'sendEmail(')
  c = c.replace(/\btransporter\.sendMail\(/g, 'sendEmail(')

  // Strip all "from: ..." properties referencing Gmail env vars / locals.
  c = c.replace(/^\s*from:\s*`First Equity Funding <\$\{(?:gmailUser|user|process\.env\.GMAIL_USER)\}>`,\s*\r?\n/gm, '')
  c = c.replace(/from:\s*`First Equity Funding <\$\{(?:gmailUser|user|process\.env\.GMAIL_USER)\}>`,\s*/g, '')

  if (!/from ['"]@\/lib\/mailer['"]/.test(c)) {
    c = c.replace(
      /((?:^import [^\n]+\r?\n)+)/m,
      (block) => block + "import { sendEmail } from '@/lib/mailer'\n",
    )
  }

  if (c === orig) continue
  writeFileSync(f, c)
  total++
  console.log('✓ ' + f)
}
console.log(`\nDone. ${total}/${FILES.length} files updated.`)
