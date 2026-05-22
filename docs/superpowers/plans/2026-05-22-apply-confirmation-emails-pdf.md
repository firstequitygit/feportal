# Apply Confirmation, Emails & Application PDF - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a public loan application is submitted, store a masked PDF of the application on its loan, email the borrower an activation link, and email the processing inbox + assigned loan officer a link to that PDF - all via Resend.

**Architecture:** A single best-effort orchestrator (`apply-notify.ts`) runs inside Next.js `after()` from the submit route: it renders the application to a PDF (`@react-pdf/renderer`), uploads it to the private `documents` bucket and links it to the loan, mints a long-lived signed URL, resolves the assigned LO email via a swappable seam, generates the borrower's portal activation link, and sends two branded emails. The confirmation page is polished to prompt activation.

**Tech Stack:** Next.js 16 (App Router, Node runtime), TypeScript, `@react-pdf/renderer`, Resend (existing `sendEmail`), Supabase admin client + Storage.

**Worktree:** `C:\Users\apalm\FE-Portal\feportal-apply` on branch `feature/apply-confirmation-pdf`. All paths below are relative to this worktree.

**Testing note:** This project has **no test runner**; the correctness gate is the TypeScript compiler and a real submit walkthrough. Each task's verification step is `npx tsc --noEmit` (run in this worktree, which has no dev server holding the lock). A final task does a full `npm run build` and a manual end-to-end submit.

**Two user-supplied inputs** (the build compiles without them; placeholders are clearly marked):
- `APPLICATIONS_PROCESSING_INBOX` env var (the shared processing inbox).
- The 9 loan-officer emails in `LOAN_OFFICER_EMAILS`.

---

### Task 1: Worktree dependencies + `@react-pdf/renderer`

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)

- [ ] **Step 1: Install dependencies in the worktree**

A fresh git worktree has no `node_modules`. Install everything, then add the PDF library.

Run:
```bash
cd /c/Users/apalm/FE-Portal/feportal-apply
npm install
npm install @react-pdf/renderer
```
Expected: completes; `@react-pdf/renderer` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Baseline type-check**

Run: `npx tsc --noEmit`
Expected: exits 0 (clean baseline before any code changes).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(apply): add @react-pdf/renderer for application PDF"
```

---

### Task 2: Signed document URL helper

**Files:**
- Create: `src/lib/supabase/signed-url.ts`

- [ ] **Step 1: Write the helper**

```ts
import type { createAdminClient } from '@/lib/supabase/admin'

/** Effectively non-expiring: ~10 years in seconds. The documents bucket stays
 *  private; the PDF masks sensitive data, so a long-lived signed link is
 *  acceptable (design decision 2026-05-22). */
export const TEN_YEARS_SECONDS = 315_360_000

/** Mint a signed download URL for an object in the private `documents` bucket.
 *  Returns null on failure (caller treats the link as unavailable). */
export async function getSignedDocumentUrl(
  admin: ReturnType<typeof createAdminClient>,
  filePath: string,
  ttlSeconds: number = TEN_YEARS_SECONDS,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from('documents')
    .createSignedUrl(filePath, ttlSeconds)
  if (error) {
    console.error('createSignedUrl failed:', error.message)
    return null
  }
  return data?.signedUrl ?? null
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/signed-url.ts
git commit -m "feat(apply): signed document URL helper"
```

---

### Task 3: Loan-officer email routing seam

**Files:**
- Create: `src/lib/loan-officer-emails.ts`

- [ ] **Step 1: Write the map + resolver**

Keys MUST match `LOAN_OFFICER_OPTIONS` in `src/lib/application-fields.ts` exactly. Values are placeholders for the user to fill (see TODO).

```ts
// Interim loan-officer email routing. The application stores only the LO's
// display name (data.primary.loan_officer_assigned). There is no name->email
// link yet; the planned replacement drives this from active LO portal users.
// When that lands, replace ONLY the body of resolveLoanOfficerEmail - callers
// and the signature stay the same.

// TODO(user): fill in the real addresses. "Other" intentionally has no email.
export const LOAN_OFFICER_EMAILS: Record<string, string> = {
  'Christian Pepe': '',
  'Anthony Palmiotto': '',
  'Cory J Anderson': '',
  'Ryan Commesso': '',
  'Bill McGrorry': '',
  'Vincent Gruosso': '',
  'Adam Scovill': '',
  'Garry Merritt': '',
  'Christopher Marcigliano': '',
}

/** Resolve the assigned loan officer's email, or null when unknown/"Other"/unmapped. */
export function resolveLoanOfficerEmail(name: string | null | undefined): string | null {
  if (!name) return null
  const email = LOAN_OFFICER_EMAILS[name.trim()]
  return email && email.includes('@') ? email : null
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/loan-officer-emails.ts
git commit -m "feat(apply): loan-officer email routing seam"
```

---

### Task 4: Extract a borrower activation-link helper

**Files:**
- Modify: `src/lib/invite-borrower.ts`

Extract the create/link-auth-user + generate-recovery-link logic into a reusable, email-free helper, then make `inviteBorrower` call it. Behavior for existing callers is unchanged.

- [ ] **Step 1: Add `ensureBorrowerActivationLink` and refactor `inviteBorrower`**

Replace the body of `inviteBorrower` (lines 26-112) so the account-provisioning + link-generation lives in the new exported function. Keep the existing imports at the top of the file.

```ts
/** Ensure the borrower has a Supabase auth account (creating/linking as needed)
 *  and return a single-use recovery action link to /auth/callback?next=/dashboard.
 *  Does NOT send any email. Idempotent across all three account states:
 *  no row, intake row without auth, already-linked. */
export async function ensureBorrowerActivationLink(
  email: string,
  fullName?: string,
): Promise<string> {
  const adminClient = createAdminClient()

  const { data: existing } = await adminClient
    .from('borrowers')
    .select('id, auth_user_id')
    .eq('email', email)
    .maybeSingle()

  if (!existing) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (authError) throw new Error(authError.message)
    const { error: borrowerError } = await adminClient
      .from('borrowers')
      .insert({ auth_user_id: authUser.user.id, email, full_name: fullName ?? null })
    if (borrowerError) throw new Error(borrowerError.message)
  } else if (!existing.auth_user_id) {
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (authError) throw new Error(authError.message)
    const { error: linkError } = await adminClient
      .from('borrowers')
      .update({ auth_user_id: authUser.user.id, full_name: fullName ?? undefined })
      .eq('id', existing.id)
    if (linkError) throw new Error(linkError.message)
  }

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${PORTAL_URL}/auth/callback?next=/dashboard` },
  })
  if (linkError || !linkData) throw new Error(linkError?.message ?? 'Failed to generate invite link')
  return linkData.properties.action_link
}
```

Then change `inviteBorrower` to reuse it. Replace the account-provisioning + link block (old lines 35-75) with a call, keeping the rest (greeting, email send, return) intact:

```ts
export async function inviteBorrower(input: InviteBorrowerInput): Promise<InviteBorrowerResult> {
  const { email, fullName } = input

  const inviteLink = await ensureBorrowerActivationLink(email, fullName)

  // borrowerId for the result: re-read (the helper guarantees a row exists).
  const adminClient = createAdminClient()
  const { data: row } = await adminClient
    .from('borrowers').select('id').eq('email', email).maybeSingle()
  const borrowerId = row?.id ?? null

  const firstName = (fullName ?? '').trim().split(/\s+/)[0]
  const greetingName = firstName || (fullName ?? '').trim() || 'there'

  let emailSent = false
  let emailError: string | null = null
  try {
    await sendEmail({
      to: email,
      subject: `You've been invited to the First Equity Funding Online Portal`,
      html: `
        <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi ${greetingName},</p>
        <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
          You've been invited to the <strong>First Equity Funding Online Portal</strong>, where you can track
          your loan, upload required documents, and message your team.
        </p>
        <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
          Click the button below to sign in to your portal.
        </p>
        <p style="margin-top: 24px;">
          <a href="${inviteLink}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
            Sign In
          </a>
        </p>
        <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
          This link expires in 24 hours and can only be used once. If you didn't expect this invitation,
          you can ignore this email.
        </p>
        <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">First Equity Funding Online Portal</p>
      `,
    })
    emailSent = true
  } catch (err) {
    emailError = err instanceof Error ? err.message : 'Unknown email error'
    console.error('Invite borrower email error:', emailError)
  }

  return { borrowerId, inviteLink, emailSent, emailError }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/invite-borrower.ts
git commit -m "refactor(apply): extract ensureBorrowerActivationLink (email-free)"
```

---

### Task 5: Application PDF generator

**Files:**
- Create: `src/lib/pdf/application-pdf.tsx`

Scopes (verified in code): primary = `data.primary`; co-borrowers = `data.co_borrowers[i]`; deal/experience/declarations/HMDA = root `data`; units = `data.units[i]`; signature = `data.auth_signature`. SSN is masked inside the generator.

- [ ] **Step 1: Write the generator**

```tsx
import {
  Document, Page, View, Text, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer'
import {
  BORROWER_FIELDS, PRIMARY_EXTRA_FIELDS, DEAL_FIELDS, EXPERIENCE_FIELDS,
  DECLARATION_FIELDS, HMDA_FIELDS, UNIT_FIELDS,
  isVisible, dscrUnitCount,
  type FieldDef, type ApplicationData,
} from '@/lib/application-fields'

const NAVY = '#1F5D8F'

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, fontSize: 9, color: '#1f2937', fontFamily: 'Helvetica' },
  header: { backgroundColor: NAVY, padding: 16, borderRadius: 4, marginBottom: 14 },
  headerTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  headerSub: { fontSize: 9, marginTop: 4, color: '#dbeafe' },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 14, marginBottom: 5, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 3 },
  subTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#374151', marginTop: 8, marginBottom: 2 },
  row: { flexDirection: 'row', paddingVertical: 1.5 },
  label: { width: '48%', color: '#6b7280', paddingRight: 8 },
  value: { width: '52%' },
  empty: { color: '#9ca3af', fontStyle: 'italic' },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: '#9ca3af', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 5 },
})

function maskSSN(v: unknown): string {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `XXX-XX-${digits.slice(-4)}` : '***'
}

function isEmptyVal(v: unknown): boolean {
  return v === undefined || v === null || v === ''
}

function formatValue(f: FieldDef, raw: unknown): string {
  if (isEmptyVal(raw)) return '-'
  if (f.type === 'ssn') return maskSSN(raw)
  if (f.type === 'yesno' || typeof raw === 'boolean') return raw === true ? 'Yes' : raw === false ? 'No' : '-'
  if (f.type === 'currency') {
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,\s]/g, ''))
    return Number.isNaN(num) ? String(raw) : `$${num.toLocaleString('en-US')}`
  }
  return String(raw)
}

function FieldRows({ fields, scope, data }: { fields: readonly FieldDef[]; scope: ApplicationData; data: ApplicationData }) {
  const rows = fields.filter(f => isVisible(f, data, scope) && !isEmptyVal(scope[f.name]))
  if (rows.length === 0) return <Text style={styles.empty}>Not provided.</Text>
  return (
    <>
      {rows.map(f => (
        <View key={f.name} style={styles.row} wrap={false}>
          <Text style={styles.label}>{f.label}</Text>
          <Text style={styles.value}>{formatValue(f, scope[f.name])}</Text>
        </View>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

/** Render the full application to a PDF Buffer. SSN is masked to last 4. */
export async function renderApplicationPdf(data: ApplicationData): Promise<Buffer> {
  const primary = (data.primary as ApplicationData) ?? {}
  const cobs: ApplicationData[] = Array.isArray(data.co_borrowers) ? (data.co_borrowers as ApplicationData[]) : []
  const units: ApplicationData[] = Array.isArray(data.units) ? (data.units as ApplicationData[]) : []
  const unitCount = dscrUnitCount(data)
  const submittedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const propStreet = [data.property_street, data.property_city, data.property_state, data.property_zip].filter(Boolean).join(', ')

  const doc = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>First Equity Funding - Loan Application</Text>
          <Text style={styles.headerSub}>{propStreet || 'Subject property not provided'} | Submitted {submittedOn}</Text>
        </View>

        <Section title="Primary Borrower">
          <FieldRows fields={[...BORROWER_FIELDS, ...PRIMARY_EXTRA_FIELDS]} scope={primary} data={data} />
        </Section>

        {cobs.map((cb, i) => (
          <Section key={`cb-${i}`} title={`Co-Borrower ${i + 1}`}>
            <FieldRows fields={BORROWER_FIELDS} scope={cb} data={data} />
          </Section>
        ))}

        <Section title="Deal & Property">
          <FieldRows fields={DEAL_FIELDS} scope={data} data={data} />
        </Section>

        {unitCount > 0 && (
          <Section title="Rental Units">
            {Array.from({ length: unitCount }).map((_, i) => (
              <View key={`u-${i}`}>
                <Text style={styles.subTitle}>Unit {i + 1}</Text>
                <FieldRows fields={UNIT_FIELDS} scope={(units[i] ?? {}) as ApplicationData} data={data} />
              </View>
            ))}
          </Section>
        )}

        <Section title="Experience">
          <FieldRows fields={EXPERIENCE_FIELDS} scope={data} data={data} />
        </Section>

        <Section title="Declarations">
          <FieldRows fields={DECLARATION_FIELDS} scope={data} data={data} />
          {!isEmptyVal(data.declarations_explanation) && (
            <View style={styles.row} wrap={false}>
              <Text style={styles.label}>Explanation</Text>
              <Text style={styles.value}>{String(data.declarations_explanation)}</Text>
            </View>
          )}
        </Section>

        <Section title="Government Monitoring (HMDA)">
          <FieldRows fields={HMDA_FIELDS} scope={data} data={data} />
        </Section>

        <Section title="Authorization">
          <View style={styles.row} wrap={false}>
            <Text style={styles.label}>Signature</Text>
            <Text style={styles.value}>{isEmptyVal(data.auth_signature) ? '-' : String(data.auth_signature)}</Text>
          </View>
        </Section>

        <View style={styles.footer} fixed>
          <Text>First Equity Funding - Confidential</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0. (If JSX-in-`.tsx`-server-module raises a React import issue, add `import React from 'react'` at the top.)

- [ ] **Step 3: Manual render sanity-check (throwaway)**

Create a temp script `tmp-pdf-check.mjs` is overkill; instead verify via a one-off in the verification task. Skip a dedicated runtime check here - the type-check plus the Task 11 end-to-end submit covers it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pdf/application-pdf.tsx
git commit -m "feat(apply): masked application PDF generator (@react-pdf/renderer)"
```

---

### Task 6: Mapper - populate `meta.loanOfficerName`

**Files:**
- Modify: `src/lib/application-mapper.ts:158-163`

The `meta.loanOfficerName` field exists but is hardcoded `null`. Populate it from the primary's selection so the orchestrator and emails have a clean source.

- [ ] **Step 1: Set the value**

Change the `meta` block in the return (currently `loanOfficerName: null`) to:

```ts
    meta: {
      loanOfficerName: s(primary.loan_officer_assigned),
      primaryEmail: s(primary.email),
      primaryFirstName: s(primary.first_name),
      propertyAddress: propAddress || 'your property',
    },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/application-mapper.ts
git commit -m "feat(apply): carry assigned loan officer name in mapper meta"
```

---

### Task 7: Emails - enhance borrower email + add internal notice

**Files:**
- Modify: `src/lib/email.ts`

Add a small currency formatter, enhance `sendApplicationSubmittedEmail` (activation link + light recap, no sensitive data, no attachment), and add `sendApplicationInternalNotice`.

- [ ] **Step 1: Replace `sendApplicationSubmittedEmail` (lines 291-299) and add the internal notice**

Add near the other helpers:

```ts
function fmtAmount(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return null
  return `$${Number(amount).toLocaleString('en-US')}`
}
```

Replace `sendApplicationSubmittedEmail` with:

```ts
export async function sendApplicationSubmittedEmail(
  email: string,
  firstName: string | null,
  propertyAddress: string,
  activationLink: string | null,
  recap?: { loanType?: string | null; loanAmount?: number | null },
) {
  const amount = fmtAmount(recap?.loanAmount)
  const recapRows = [
    `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Property</td><td style="padding:4px 0;font-size:13px;"><strong>${propertyAddress}</strong></td></tr>`,
    recap?.loanType ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Loan type</td><td style="padding:4px 0;font-size:13px;">${recap.loanType}</td></tr>` : '',
    amount ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Requested amount</td><td style="padding:4px 0;font-size:13px;">${amount}</td></tr>` : '',
  ].join('')

  const activationBlock = activationLink ? `
    <p style="font-size: 15px;">Activate your portal account to track your loan, upload documents, and message your team.</p>
    <p style="margin-top: 20px;">
      <a href="${activationLink}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Activate your portal account</a>
    </p>
    <p style="font-size: 12px; color: #999; margin-top: 16px;">This link is private to you and expires in 24 hours.</p>` : ''

  const html = wrap('Application received', `
    <p style="font-size: 15px; margin-top: 0;">Hi ${firstName ?? 'there'},</p>
    <p style="font-size: 15px;">We've received your loan application. Our team will review it and reach out with next steps. Thank you for choosing First Equity Funding.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">${recapRows}</table>
    ${activationBlock}`)

  await getTransporter().sendMail({
    to: email, subject: 'We received your First Equity loan application', html,
  }).catch(err => console.error(`Submitted email to ${email} failed:`, err))
}
```

Add the internal notice (replaces the role of the old `sendApplicationLoanOfficerNotice`):

```ts
export async function sendApplicationInternalNotice(opts: {
  to: string[]
  applicantName: string
  propertyAddress: string
  loanType: string | null
  loanAmount: number | null
  loanId: string
  pdfUrl: string | null
  loanOfficerName: string | null
}) {
  const amount = fmtAmount(opts.loanAmount)
  const pdfButton = opts.pdfUrl ? `
    <p style="margin-top: 20px;">
      <a href="${opts.pdfUrl}" style="background-color: #1F5D8F; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Download application (PDF)</a>
    </p>
    <p style="font-size: 12px; color: #6b7280;">The application is also saved to the loan in the portal.</p>`
    : `<p style="font-size: 13px; color: #b91c1c;">Application PDF could not be generated; check the loan in the portal.</p>`

  const html = wrap('New loan application', `
    <p style="font-size: 15px; margin-top: 0;">A new application was submitted.</p>
    <p style="font-size: 15px;">
      <strong>Applicant:</strong> ${opts.applicantName}<br/>
      <strong>Property:</strong> ${opts.propertyAddress}<br/>
      ${opts.loanType ? `<strong>Loan type:</strong> ${opts.loanType}<br/>` : ''}
      ${amount ? `<strong>Requested amount:</strong> ${amount}<br/>` : ''}
      <strong>Assigned loan officer:</strong> ${opts.loanOfficerName ?? 'Unassigned'}
    </p>
    ${pdfButton}
    <p style="margin-top: 20px;">
      <a href="${PORTAL_URL}/admin/loans/${opts.loanId}" style="color:#1F5D8F;font-size:13px;">Open the loan in the portal</a>
    </p>`)

  await getTransporter().sendMail({
    to: opts.to,
    subject: `New loan application - ${opts.propertyAddress}`,
    html,
  }).catch(err => console.error(`Internal notice to ${opts.to.join(', ')} failed:`, err))
}
```

Note: leave the old `sendApplicationLoanOfficerNotice` in place (unused after Task 9) to avoid touching unrelated callers; it can be removed in the refine phase if nothing references it.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat(apply): borrower activation email + internal notice with PDF link"
```

---

### Task 8: Notification orchestrator

**Files:**
- Create: `src/lib/apply-notify.ts`

- [ ] **Step 1: Write the orchestrator**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { ApplicationData } from '@/lib/application-fields'
import type { MappedApplication } from '@/lib/application-mapper'
import { renderApplicationPdf } from '@/lib/pdf/application-pdf'
import { getSignedDocumentUrl } from '@/lib/supabase/signed-url'
import { resolveLoanOfficerEmail } from '@/lib/loan-officer-emails'
import { ensureBorrowerActivationLink } from '@/lib/invite-borrower'
import { sendApplicationSubmittedEmail, sendApplicationInternalNotice } from '@/lib/email'

/** All post-submit side effects, each best-effort and individually logged.
 *  Intended to run inside Next.js after() so it stays off the response path. */
export async function sendApplicationNotifications(args: {
  loanId: string
  data: ApplicationData
  m: MappedApplication
}) {
  const { loanId, data, m } = args
  const admin = createAdminClient()

  const primaryEmail = m.meta.primaryEmail
  const primaryFirstName = m.meta.primaryFirstName
  const primaryFullName = m.borrowers[0]?.full_name ?? 'Applicant'
  const propertyAddress = m.meta.propertyAddress
  const loanTypeLabel = typeof data.loan_type === 'string' ? data.loan_type : null
  const loanAmount = m.loan.loan_amount
  const loanOfficerName = m.meta.loanOfficerName

  // 1-3. Generate + store the PDF, then mint a signed URL.
  let pdfUrl: string | null = null
  try {
    const pdf = await renderApplicationPdf(data)
    const filePath = `loans/${loanId}/loan-application.pdf`
    const { error: upErr } = await admin.storage
      .from('documents')
      .upload(filePath, pdf, { contentType: 'application/pdf', upsert: true })
    if (upErr) throw new Error(upErr.message)

    await admin.from('documents').insert({
      loan_id: loanId,
      condition_id: null,
      file_name: `Loan Application - ${propertyAddress}.pdf`,
      file_path: filePath,
      file_size: pdf.length,
    })

    pdfUrl = await getSignedDocumentUrl(admin, filePath)
  } catch (err) {
    console.error('Application PDF generation/storage failed:', err)
  }

  // 4. Borrower activation link (best-effort).
  let activationLink: string | null = null
  if (primaryEmail) {
    try {
      activationLink = await ensureBorrowerActivationLink(primaryEmail, primaryFullName)
    } catch (err) {
      console.error('Borrower activation link failed:', err)
    }
  }

  // 5. Borrower email.
  if (primaryEmail) {
    await sendApplicationSubmittedEmail(
      primaryEmail, primaryFirstName, propertyAddress, activationLink,
      { loanType: loanTypeLabel, loanAmount },
    )
  }

  // 6. Internal email -> processing inbox + assigned LO.
  const processingInbox = process.env.APPLICATIONS_PROCESSING_INBOX || null
  const loEmail = resolveLoanOfficerEmail(loanOfficerName)
  const to = [processingInbox, loEmail].filter((e): e is string => !!e && e.includes('@'))
  if (to.length > 0) {
    await sendApplicationInternalNotice({
      to, applicantName: primaryFullName, propertyAddress,
      loanType: loanTypeLabel, loanAmount, loanId, pdfUrl, loanOfficerName,
    })
  } else {
    console.warn('Application internal notice skipped: no processing inbox or LO email resolved.')
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/apply-notify.ts
git commit -m "feat(apply): post-submit notification orchestrator"
```

---

### Task 9: Wire the submit route via `after()`

**Files:**
- Modify: `src/app/api/apply/submit/route.ts` (imports + step 6, lines 1-9 and 184-189)

- [ ] **Step 1: Update imports**

Replace the email import line (line 8) and add `after`:

```ts
import { after } from 'next/server'
import { sendApplicationNotifications } from '@/lib/apply-notify'
```
Remove: `import { sendApplicationSubmittedEmail, sendApplicationLoanOfficerNotice } from '@/lib/email'`.

- [ ] **Step 2: Replace step 6 (lines 184-187) with the scheduled orchestrator**

```ts
  // 6. Notifications (best-effort, off the response critical path).
  after(async () => {
    try {
      await sendApplicationNotifications({ loanId, data, m })
    } catch (err) {
      console.error('Application notifications failed:', err)
    }
  })

  return NextResponse.json({ success: true, loanId })
```

(Delete the old borrower-email call and the `anyLo` lookup + `sendApplicationLoanOfficerNotice` call.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0. If `after` is not exported from `next/server` in this version, fall back to awaiting `sendApplicationNotifications(...)` inline before the return (still best-effort via its internal try/catches).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/apply/submit/route.ts
git commit -m "feat(apply): run post-submit notifications via after()"
```

---

### Task 10: Polish the confirmation page

**Files:**
- Modify: `src/app/apply/submitted/page.tsx`

A polished, centered navy card with an activation prompt and a "what happens next" timeline. (Phase 4 may refine visuals further; this is a solid baseline.)

- [ ] **Step 1: Replace the file**

```tsx
import Link from 'next/link'

export const metadata = { title: 'Application Received' }

const STEPS = [
  { n: 1, title: 'We review your application', body: 'Our team reviews your submission, usually within one business day.' },
  { n: 2, title: 'Your loan officer reaches out', body: 'They confirm details and walk you through next steps and required documents.' },
  { n: 3, title: 'Move toward closing', body: 'Track progress, upload documents, and message your team from your portal.' },
]

export default function SubmittedPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#1F5D8F]/10">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#1F5D8F]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-[#1F5D8F]">Application received</h1>
        <p className="text-slate-600">Thank you. Your application is in and our team will be in touch.</p>

        <div className="my-6 rounded-xl bg-[#1F5D8F]/5 p-5 text-left">
          <p className="text-sm font-semibold text-[#1F5D8F]">Check your email to activate your portal account</p>
          <p className="mt-1 text-sm text-slate-600">
            We just emailed you a secure link to activate your account, where you can track your loan,
            upload documents, and message your team.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">What happens next</h2>
        <ol className="space-y-4">
          {STEPS.map(s => (
            <li key={s.n} className="flex gap-4">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#1F5D8F] text-sm font-semibold text-white">{s.n}</span>
              <div>
                <p className="font-medium text-slate-900">{s.title}</p>
                <p className="text-sm text-slate-600">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-8 text-center text-sm text-slate-500">
        Already have a portal account? <Link href="/login" className="font-medium text-[#1F5D8F] underline">Sign in</Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/apply/submitted/page.tsx
git commit -m "feat(apply): polished confirmation page with activation prompt + next steps"
```

---

### Task 11: Final verification (build + end-to-end)

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 2: Set runtime env for a real submit**

Ensure the running app has `APPLICATIONS_PROCESSING_INBOX` set (a test address you can read) and a valid `RESEND_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_PORTAL_URL`. Optionally fill one entry in `LOAN_OFFICER_EMAILS` matching the LO you'll pick in the test application.

- [ ] **Step 3: End-to-end submit walkthrough**

Start a dev server in this worktree on a free port (3000 is used by the main worktree): `npm run dev -- -p 3100`. Complete a test application at `http://localhost:3100/apply` and submit. Verify:
- Confirmation page renders the activation prompt + timeline.
- Borrower receives the "Application received" email with a working **Activate your portal account** link.
- Internal email reaches `APPLICATIONS_PROCESSING_INBOX` (+ LO if mapped) with a working **Download application (PDF)** link.
- The PDF is well laid out and the **SSN shows as XXX-XX-1234**.
- The document appears on the loan in the portal (admin view: `/admin/loans/{loanId}`).
- Re-submitting/refresh does not create duplicate loans or duplicate emails (idempotency: route short-circuits on `status === 'submitted'`).

- [ ] **Step 4: Confirm no auth-gate regression**

This build creates borrower auth users via the activation helper but does not change any role-check code. Sanity-check that `/apply` is still publicly reachable and that staff role gates are unaffected (per project `playwright-role-gates` if any auth surface appears touched).

---

## Self-Review

**Spec coverage:**
- Confirmation page + activation prompt -> Task 10. ✓
- Borrower email (activation link, light recap, no sensitive data, no attachment) -> Task 7 (`sendApplicationSubmittedEmail`). ✓
- Internal email to processing inbox + assigned LO with PDF link -> Tasks 7 + 8. ✓
- Application PDF, SSN masked -> Task 5. ✓
- Store PDF in portal, linked to loan, viewable -> Task 8 (storage upload + `documents` insert). ✓
- Non-expiring signed link, private bucket -> Task 2 + Task 8. ✓
- LO routing seam -> Task 3 + Task 6 (meta) + Task 8. ✓
- Activation link helper -> Task 4. ✓
- `after()` wiring -> Task 9. ✓
- Resend throughout -> reuses existing `getTransporter()`/`sendEmail`. ✓
- Out of scope (payment, domain auth, Maps code) -> not in any task, per spec. ✓

**Placeholder scan:** The only intentional placeholders are the empty `LOAN_OFFICER_EMAILS` values (flagged `TODO(user)`) and the `APPLICATIONS_PROCESSING_INBOX` env value - both are user-supplied data, not code gaps. No "TBD"/"handle edge cases"/"similar to" placeholders.

**Type consistency:** `sendApplicationNotifications({ loanId, data, m })` matches the call in Task 9. `ensureBorrowerActivationLink(email, fullName?)` (Task 4) matches its use in Task 8. `getSignedDocumentUrl(admin, path, ttl?)` (Task 2) matches Task 8. `sendApplicationSubmittedEmail(email, firstName, propertyAddress, activationLink, recap?)` and `sendApplicationInternalNotice({...})` (Task 7) match Task 8. `renderApplicationPdf(data)` returns `Buffer`, consumed by `storage.upload` in Task 8. `MappedApplication.meta.loanOfficerName` populated in Task 6, read in Task 8. Consistent.
