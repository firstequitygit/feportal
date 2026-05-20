'use client'
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CurrencyInput } from "@/components/ui/currency-input"
import { isVisible, type FieldDef, type ApplicationData } from "@/lib/application-fields"

type Props = {
  fields: FieldDef[]
  data: ApplicationData          // whole-form data (for visibleWhen on deal fields)
  scope: Record<string, unknown> // the object being edited (primary, a co-borrower, the form root)
  onChange: (name: string, value: unknown) => void
}

export function FieldRenderer({ fields, data, scope, onChange }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.filter(f => isVisible(f, data, scope)).map(f => {
        const v = scope[f.name]
        const id = `f-${f.name}`
        const wide = f.type === 'textarea' || f.type === 'radio' || f.type === 'file'
        return (
          <div key={f.name} className={`space-y-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
            <Label htmlFor={id}>{f.label}{f.required ? ' *' : ''}</Label>
            {f.type === 'textarea' ? (
              <textarea id={id} className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)} />
            ) : f.type === 'select' ? (
              <select id={id} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)}>
                <option value="">— Select —</option>
                {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'yesno' ? (
              <div className="flex gap-4 pt-1">
                {['Yes','No'].map(lbl => (
                  <label key={lbl} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={id} checked={v === (lbl === 'Yes')}
                      onChange={() => onChange(f.name, lbl === 'Yes')} /> {lbl}
                  </label>
                ))}
              </div>
            ) : f.type === 'radio' ? (
              <div className="flex flex-col gap-1.5 pt-1">
                {f.options!.map(o => (
                  <label key={o} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={id} checked={v === o}
                      onChange={() => onChange(f.name, o)} /> {o}
                  </label>
                ))}
              </div>
            ) : f.type === 'file' ? (
              // v1: documents are collected post-submit through the existing conditions flow.
              // The field is preserved in the config for future upload work.
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                You can upload this file after submitting — your loan officer will request it through the borrower portal.
              </p>
            ) : f.type === 'currency' ? (
              <CurrencyInput id={id} name={f.name}
                value={String(v ?? '')}
                onChange={(val) => onChange(f.name, val)} />
            ) : (
              <Input id={id}
                type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'date' ? 'date' : 'text'}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                placeholder={f.placeholder ?? (f.type === 'ssn' ? '###-##-####' : undefined)}
                value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)} />
            )}
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        )
      })}
    </div>
  )
}
