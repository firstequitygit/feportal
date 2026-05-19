'use client'
import { DECLARATION_FIELDS, HMDA_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'

export function Step4Declarations({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  const primary = (data.primary as Record<string, unknown>) ?? {}
  const cobs = Array.isArray(data.co_borrowers) ? (data.co_borrowers as Record<string, unknown>[]) : []
  const blocks = [
    { label: 'Primary Borrower', scope: primary, save: (n: string, v: unknown) => set({ primary: { ...primary, [n]: v } }) },
    ...cobs.map((c, i) => ({
      label: `Co-Borrower ${i + 1}`, scope: c,
      save: (n: string, v: unknown) => set({ co_borrowers: cobs.map((x, idx) => idx === i ? { ...x, [n]: v } : x) }),
    })),
  ]
  return (
    <div className="space-y-8">
      {blocks.map((bk, idx) => (
        <div key={idx} className="space-y-4">
          <h3 className="font-medium text-[#1F5D8F]">{bk.label} — Declarations</h3>
          <FieldRenderer fields={DECLARATION_FIELDS} data={data} scope={bk.scope} onChange={bk.save} />
          <h4 className="font-medium">Government Monitoring (HMDA)</h4>
          <FieldRenderer fields={HMDA_FIELDS} data={data} scope={bk.scope} onChange={bk.save} />
        </div>
      ))}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">If you answered yes to any of the above declarations, please explain</label>
        <textarea className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          value={(data.declarations_explanation as string) ?? ''} onChange={e => set({ declarations_explanation: e.target.value })} />
      </div>
    </div>
  )
}
