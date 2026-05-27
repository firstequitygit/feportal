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

    // Guard against a duplicate row if after() ever runs twice for this loan.
    const { data: existingDoc } = await admin
      .from('documents')
      .select('id')
      .eq('loan_id', loanId)
      .eq('file_path', filePath)
      .maybeSingle()
    if (!existingDoc) {
      await admin.from('documents').insert({
        loan_id: loanId,
        condition_id: null,
        file_name: `Loan Application - ${propertyAddress}.pdf`,
        file_path: filePath,
        file_size: pdf.length,
      })
    }

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

  // 5. Borrower email (isolated so a failure here can't suppress the internal notice).
  if (primaryEmail) {
    try {
      await sendApplicationSubmittedEmail(
        primaryEmail, primaryFirstName, propertyAddress, activationLink,
        { loanType: loanTypeLabel, loanAmount },
      )
    } catch (err) {
      console.error('Borrower confirmation email failed:', err)
    }
  }

  // 6. Internal email -> processing inbox + assigned LO.
  const processingInbox = process.env.APPLICATIONS_PROCESSING_INBOX || null
  const loEmail = await resolveLoanOfficerEmail(loanOfficerName)
  const to = [processingInbox, loEmail].filter((e): e is string => !!e && e.includes('@'))
  if (to.length > 0) {
    try {
      await sendApplicationInternalNotice({
        to, applicantName: primaryFullName, propertyAddress,
        loanType: loanTypeLabel, loanAmount, loanId, pdfUrl, loanOfficerName,
      })
    } catch (err) {
      console.error('Application internal notice failed:', err)
    }
  } else {
    console.warn('Application internal notice skipped: no processing inbox or LO email resolved.')
  }
}
