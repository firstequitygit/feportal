'use client'
import { type ApplicationData } from '@/lib/application-fields'

const CERT_TEXT = `The Undersigned certifies the following: (1) I/We have applied for a mortgage loan through First Equity Funding, LP. In applying for the loan, I/We completed a loan application containing various information on the purpose of the loan, the amount and source of the down payment, employment and income information, and the assets and liabilities. I/We certify that all of the information is true and complete. I/We made no misrepresentations in the loan application or other documents, nor did I/We omit any pertinent information. (2) I/We understand and agree that First Equity Funding, LP reserves the right to change the mortgage loan review processes to a full documentation program. (3) I/We fully understand that it is a Federal crime punishable by fine or imprisonment, or both, to knowingly make any false statements when applying for this mortgage, as applicable under the provisions of Title 18, United States Code, Section 1014.`
const AUTH_TEXT = `AUTHORIZATION TO RELEASE INFORMATION — I/We have applied for a mortgage loan through First Equity Funding, LP. As part of the application process, First Equity Funding, LP and the mortgage guaranty insurer (if any), may verify information contained in my/our loan application and in other documents required in connection with the loan. I/We authorize First Equity Funding, LP and its affiliates to order a background check and a consumer credit report and to charge my credit card to pay for these services and any appraisal/draw inspection/processing fees. A copy of this authorization may be accepted as an original. I understand this is not a commitment to lend and that these fees are non-refundable.`

function Block({ id, title, text, data, set }: {
  id: string; title: string; text: string
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const printed = [primary.first_name, primary.last_name].filter(Boolean).join(' ')
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium text-[#1F5D8F]">{title}</h3>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700">{text}</p>
      <p className="text-sm">Printed name: <strong>{printed || '—'}</strong> · Date: {new Date().toLocaleDateString()}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data[`${id}_agree`] === true}
          onChange={e => set({ [`${id}_agree`]: e.target.checked })} />
        I have read and agree to the above.
      </label>
      <div className="space-y-1.5">
        <label className="text-sm">Type your full legal name as your signature *</label>
        <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={(data[`${id}_signature`] as string) ?? ''} onChange={e => set({ [`${id}_signature`]: e.target.value })} />
      </div>
    </div>
  )
}

export function Step5Authorization({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-6">
      <Block id="cert" title="Borrowers' Certification and Authorization" text={CERT_TEXT} data={data} set={set} />
      <Block id="auth" title="Authorization to Release Information & Charge Card" text={AUTH_TEXT} data={data} set={set} />
    </div>
  )
}
