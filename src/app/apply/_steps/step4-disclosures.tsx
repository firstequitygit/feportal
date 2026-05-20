'use client'
import { DECLARATION_FIELDS, HMDA_FIELDS, type ApplicationData } from "@/lib/application-fields"
import { FieldRenderer } from "../_components/field-renderer"

const CERT_TEXT = `The Undersigned certifies the following: (1) I/We have applied for a mortgage loan through First Equity Funding, LP. In applying for the loan, I/We completed a loan application containing various information on the purpose of the loan, the amount and source of the down payment, employment and income information, and the assets and liabilities. I/We certify that all of the information is true and complete. I/We made no misrepresentations in the loan application or other documents, nor did I/We omit any pertinent information. (2) I/We understand and agree that First Equity Funding, LP reserves the right to change the mortgage loan review processes to a full documentation program. (3) I/We fully understand that it is a Federal crime punishable by fine or imprisonment, or both, to knowingly make any false statements when applying for this mortgage, as applicable under the provisions of Title 18, United States Code, Section 1014.`
const AUTH_TEXT = `AUTHORIZATION TO RELEASE INFORMATION — I/We have applied for a mortgage loan through First Equity Funding, LP. As part of the application process, First Equity Funding, LP and the mortgage guaranty insurer (if any), may verify information contained in my/our loan application and in other documents required in connection with the loan. I/We authorize First Equity Funding, LP and its affiliates to order a background check and a consumer credit report and to charge my credit card to pay for these services and any appraisal/draw inspection/processing fees. A copy of this authorization may be accepted as an original. I understand this is not a commitment to lend and that these fees are non-refundable.`

function CertBlock({ id, title, text, data, set }: {
  id: string; title: string; text: string
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const printed = [primary.first_name, primary.last_name].filter(Boolean).join(' ')
  return (
    <div className="space-y-4 rounded-sm border border-(--apply-border) p-6">
      <h3
        className="text-lg text-(--apply-brand)"
        style={{ fontFamily: "var(--font-display)", fontVariationSettings: "'opsz' 20, 'SOFT' 20" }}
      >
        {title}
      </h3>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-sm bg-(--apply-bg) p-3 text-xs text-(--apply-ink-muted) leading-relaxed border border-(--apply-border)">
        {text}
      </p>
      <p className="text-sm text-(--apply-ink-subtle)">
        Printed name: <strong className="text-(--apply-ink)">{printed || '—'}</strong>
        <span className="mx-2 text-(--apply-ink-muted)">·</span>
        Date: {new Date().toLocaleDateString()}
      </p>
      <label className="flex items-center gap-2 text-sm text-(--apply-ink-subtle)">
        <input type="checkbox" checked={data[`${id}_agree`] === true}
          onChange={e => set({ [`${id}_agree`]: e.target.checked })} />
        I have read and agree to the above.
      </label>
      <div className="space-y-1.5">
        <label className="text-sm text-(--apply-ink) font-medium">
          Type your full legal name as your signature
          <span className="text-(--apply-brand) ml-1" aria-label="required">&#x25CF;</span>
        </label>
        <input
          className="flex h-9 w-full rounded-sm border border-(--apply-border-strong) bg-transparent px-3 text-sm outline-none transition-colors focus:border-(--apply-brand) focus:ring-1 focus:ring-(--apply-brand)/30"
          value={(data[`${id}_signature`] as string) ?? ''}
          onChange={e => set({ [`${id}_signature`]: e.target.value })}
        />
        <div className="mt-2 flex items-baseline justify-between rounded-sm border border-(--apply-border) bg-(--apply-brand-tint) px-4 py-3">
          <span
            style={{ fontFamily: "var(--font-script)" }}
            className="text-3xl text-(--apply-ink)"
          >
            {(data[`${id}_signature`] as string) ?? ''}
          </span>
          <span className="text-xs text-(--apply-ink-muted)">
            {new Date().toLocaleDateString()}
          </span>
        </div>
        <p className="text-xs text-(--apply-ink-muted) italic">
          By typing your name above, you are signing this document electronically.
        </p>
      </div>
    </div>
  )
}

export function Step4Disclosures({ data, set, missingFields }: {
  data: ApplicationData
  set: (patch: Record<string, unknown>) => void
  missingFields?: string[]
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const blocks = [
    {
      label: 'Primary Borrower',
      scope: primary,
      idPrefix: 'primary.' as string,
      save: (n: string, v: unknown) => set({ primary: { ...primary, [n]: v } }),
    },
    ...cobs.map((c, i) => ({
      label: `Co-Borrower ${i + 1}`,
      scope: c,
      idPrefix: `coborrower${i + 1}.` as string,
      save: (n: string, v: unknown) => set({ co_borrowers: cobs.map((x, idx) => idx === i ? { ...x, [n]: v } : x) }),
    })),
  ]

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-6 flex items-baseline gap-4">
          <span
            className="text-lg text-(--apply-ink)"
            style={{ fontFamily: "var(--font-display)", fontVariationSettings: "'opsz' 20, 'SOFT' 20" }}
          >
            Declarations
          </span>
          <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
        </div>
        {blocks.map((bk, idx) => (
          <div key={idx} className="mb-6 space-y-4">
            <div className="flex items-baseline gap-4">
              <span className="text-xs uppercase tracking-[0.22em] text-(--apply-ink-muted)">{bk.label}</span>
              <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
            </div>
            <FieldRenderer
              fields={DECLARATION_FIELDS}
              data={data}
              scope={bk.scope}
              onChange={bk.save}
              idPrefix={bk.idPrefix}
              missingFields={missingFields}
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-(--apply-ink)">
            If you answered yes to any of the above declarations, please explain
          </label>
          <textarea
            className="flex min-h-24 w-full rounded-sm border border-(--apply-border-strong) bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-(--apply-brand) focus:ring-1 focus:ring-(--apply-brand)/30"
            value={(data.declarations_explanation as string) ?? ''}
            onChange={e => set({ declarations_explanation: e.target.value })}
          />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline gap-4">
          <span
            className="text-lg text-(--apply-ink)"
            style={{ fontFamily: "var(--font-display)", fontVariationSettings: "'opsz' 20, 'SOFT' 20" }}
          >
            Government monitoring (HMDA)
          </span>
          <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
        </div>
        <p className="mb-6 text-sm text-(--apply-ink-subtle) leading-relaxed">
          The following questions are required by federal law for fair-lending reporting.
          They do not affect your application. You may choose &ldquo;Prefer not to answer.&rdquo;
        </p>
        {blocks.map((bk, idx) => (
          <div key={idx} className="mb-6 space-y-4">
            <div className="flex items-baseline gap-4">
              <span className="text-xs uppercase tracking-[0.22em] text-(--apply-ink-muted)">{bk.label}</span>
              <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
            </div>
            <FieldRenderer
              fields={HMDA_FIELDS}
              data={data}
              scope={bk.scope}
              onChange={bk.save}
              idPrefix={bk.idPrefix}
              missingFields={missingFields}
            />
          </div>
        ))}
      </section>

      <section>
        <div className="mb-6 flex items-baseline gap-4">
          <span
            className="text-lg text-(--apply-ink)"
            style={{ fontFamily: "var(--font-display)", fontVariationSettings: "'opsz' 20, 'SOFT' 20" }}
          >
            Authorization &amp; signature
          </span>
          <span className="flex-1 border-t border-(--apply-border)" aria-hidden />
        </div>
        <div className="space-y-6">
          <CertBlock id="cert" title="Borrowers' Certification and Authorization" text={CERT_TEXT} data={data} set={set} />
          <CertBlock id="auth" title="Authorization to Release Information & Charge Card" text={AUTH_TEXT} data={data} set={set} />
        </div>
      </section>
    </div>
  )
}
