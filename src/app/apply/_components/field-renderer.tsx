'use client'
import { Fragment, useState } from "react"
import { Mail, Phone, Calendar } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CurrencyInput } from "@/components/ui/currency-input"
import { SSNInput } from "@/components/ui/ssn-input"
import { YesNoToggle } from "@/components/ui/yes-no-toggle"
import { FieldReveal } from "@/components/ui/field-reveal"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { AddressAutocomplete } from "@/components/ui/address-autocomplete"
import { StreetViewImage } from "@/components/ui/street-view-image"
import { isVisible, isRequired, type FieldDef, type ApplicationData } from "@/lib/application-fields"
import { validators } from "./validators"

type Props = {
  fields: FieldDef[]
  data: ApplicationData          // whole-form data (for visibleWhen on deal fields)
  scope: Record<string, unknown> // the object being edited (primary, a co-borrower, the form root)
  onChange: (name: string, value: unknown) => void
  /** Prefix prepended to f.name in the DOM id, e.g. "primary." or "coborrower1." */
  idPrefix?: string
  /** Full prefixed names currently missing (from liveMissing in wizard). */
  missingFields?: string[]
  /** Optional render slot inserted at the end of each named section's items. */
  afterSection?: Record<string, React.ReactNode>
  /** Replaces the static options/optionsWhen list for the keyed field name. */
  optionsOverride?: Record<string, readonly string[]>
}

// Shared focus + border classes applied across all input types
const focusClasses = "focus:outline-none focus:ring-2 focus:ring-[#1F5D8F]/40 focus:border-[#1F5D8F]"
const baseInputClasses = `h-10 w-full rounded-md border bg-white px-3 text-sm transition-colors outline-none disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed`
const validBorder = "border-gray-300"
const invalidBorder = "border-red-500"

function inputClasses(isInvalid: boolean) {
  return `${baseInputClasses} ${isInvalid ? invalidBorder : `${validBorder} ${focusClasses}`}`
}

export function FieldRenderer({ fields, data, scope, onChange, idPrefix = "", missingFields, afterSection, optionsOverride }: Props) {
  const [blurErrors, setBlurErrors] = useState<Record<string, string | null>>({})

  function handleBlur(name: string, type: string, value: unknown) {
    const validator = validators[type === 'tel' ? 'phone' : type]
    if (!validator) return
    const error = validator(value)
    setBlurErrors(prev => ({ ...prev, [name]: error }))
  }

  // Build visible groups - section breaks only appear when there are visible fields in that section
  const visibleFields = fields.filter(f => isVisible(f, data, scope))
  const groups: Array<{ section?: string; items: FieldDef[] }> = []
  for (const f of visibleFields) {
    const last = groups[groups.length - 1]
    if (last && last.section === f.section) {
      last.items.push(f)
    } else {
      groups.push({ section: f.section, items: [f] })
    }
  }

  return (
    <div className="grid gap-y-2 gap-x-3 sm:grid-cols-2">
      {groups.map((g, gi) => (
        <Fragment key={`group-${gi}-${g.section ?? 'nosection'}`}>
          {g.section && (
            <div
              className="sm:col-span-2 mt-4 first:mt-0 mb-1.5 border-b border-gray-200 pb-1.5"
            >
              <h3 className="text-sm font-semibold text-gray-900">{g.section}</h3>
            </div>
          )}
          {g.items.map(f => {
            const v = scope[f.name]
            const id = `f-${idPrefix}${f.name}`
            const fullName = `${idPrefix}${f.name}`
            const isInvalid = missingFields?.includes(fullName) ?? false
            const wide = f.type === 'textarea' || f.type === 'radio' || f.type === 'file' || f.type === 'signature'
            const blurErr = blurErrors[f.name] ?? null
            const options = optionsOverride?.[f.name] ?? (f.optionsWhen ? f.optionsWhen(data, scope) : f.options)
            return (
              <FieldReveal key={f.name} show={true}>
                <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
                  <Label htmlFor={id} className="text-sm font-medium text-gray-700">
                    {f.label}
                    {isRequired(f, data, scope) && (
                      <>
                        <span className="text-red-500" aria-hidden="true">*</span>
                        <span className="sr-only"> (required)</span>
                      </>
                    )}
                    {f.helpTooltip && <InfoTooltip label={f.label} text={f.helpTooltip} />}
                  </Label>
                  {f.help && <p className="text-xs text-gray-500 mt-1">{f.help}</p>}
                  {f.type === 'textarea' ? (
                    <textarea
                      id={id}
                      className={`flex min-h-24 w-full rounded-md border bg-white px-3 py-2.5 text-sm transition-colors outline-none disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed ${isInvalid ? invalidBorder : `${validBorder} ${focusClasses}`}`}
                      aria-invalid={isInvalid || undefined}
                      value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)} />
                  ) : f.type === 'select' ? (
                    <div className="relative">
                      <select
                        id={id}
                        className={`h-10 appearance-none w-full rounded-md border bg-white px-3 pr-9 text-sm transition-colors outline-none disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed ${isInvalid ? invalidBorder : `${validBorder} ${focusClasses}`}`}
                        aria-invalid={isInvalid || undefined}
                        value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)}>
                        <option value="">Select</option>
                        {(options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m6 9 6 6 6-6"/>
                        </svg>
                      </div>
                    </div>
                  ) : f.type === 'yesno' ? (
                    <YesNoToggle
                      id={id}
                      name={id}
                      value={v as boolean | undefined}
                      onChange={(next) => onChange(f.name, next)}
                      invalid={isInvalid}
                    />
                  ) : f.type === 'radio' ? (
                    <div
                      id={id}
                      role="group"
                      tabIndex={-1}
                      className={`flex flex-col gap-1.5 pt-1 ${isInvalid ? 'rounded-md border border-red-500 p-2' : ''}`}
                      aria-invalid={isInvalid || undefined}>
                      {(options ?? []).map(o => (
                        <label key={o} className="flex items-center gap-1.5 text-sm text-gray-600">
                          <input type="radio" name={id} checked={v === o}
                            onChange={() => onChange(f.name, o)} /> {o}
                        </label>
                      ))}
                    </div>
                  ) : f.type === 'file' ? (
                    <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">
                      You can upload this file after submitting. Your loan officer will request it through the borrower portal.
                    </p>
                  ) : f.type === 'currency' ? (
                    <CurrencyInput id={id} name={f.name}
                      value={String(v ?? '')}
                      onChange={(val) => onChange(f.name, val)}
                      invalid={Boolean(blurErr || isInvalid)}
                      onBlur={() => handleBlur(f.name, f.type, v)} />
                  ) : f.type === 'ssn' ? (
                    <SSNInput id={id} name={f.name}
                      value={String(v ?? '')}
                      onChange={(val) => onChange(f.name, val)}
                      invalid={Boolean(blurErr || isInvalid)}
                      onBlur={() => handleBlur(f.name, f.type, v)} />
                  ) : f.type === 'signature' ? (
                    <div className="space-y-2">
                      <input
                        id={id}
                        type="text"
                        value={String(v ?? "")}
                        onChange={(e) => onChange(f.name, e.target.value)}
                        placeholder="Type your full legal name"
                        className={inputClasses(isInvalid)}
                        aria-invalid={isInvalid || undefined}
                      />
                      <div className="mt-2 flex items-baseline justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                        <span
                          className="text-2xl italic text-gray-900"
                          style={{ fontFamily: "Georgia, serif" }}
                        >
                          {String(v ?? "") || " "}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date().toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        By typing your name above, you are signing this document electronically.
                      </p>
                    </div>
                  ) : f.address ? (
                    <AddressAutocomplete
                      id={id}
                      value={(v as string) ?? ''}
                      onChange={(val) => onChange(f.name, val)}
                      onPlaceSelected={(parts) => {
                        onChange(f.name, parts.street)
                        onChange(f.address!.city, parts.city)
                        onChange(f.address!.state, parts.state)
                        onChange(f.address!.zip, parts.zip)
                        if (f.address!.lat && parts.lat !== undefined)
                          onChange(f.address!.lat, parts.lat)
                        if (f.address!.lng && parts.lng !== undefined)
                          onChange(f.address!.lng, parts.lng)
                      }}
                      invalid={isInvalid}
                      placeholder={f.placeholder}
                    />
                  ) : (() => {
                    const inputType = f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'date' ? 'date' : 'text'
                    const LeadIcon =
                      f.type === 'email' ? Mail :
                      f.type === 'tel' ? Phone :
                      f.type === 'date' ? Calendar :
                      null
                    return LeadIcon ? (
                      <div className="relative">
                        <LeadIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                        <Input id={id}
                          type={inputType}
                          inputMode={f.type === 'number' ? 'decimal' : undefined}
                          placeholder={f.placeholder}
                          className={isInvalid ? 'border-red-500 h-10 pl-10 rounded-md' : `${validBorder} ${focusClasses} h-10 pl-10 rounded-md`}
                          aria-invalid={isInvalid || undefined}
                          value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)}
                          onBlur={() => handleBlur(f.name, f.type, v)} />
                      </div>
                    ) : (
                      <Input id={id}
                        type={inputType}
                        inputMode={f.type === 'number' ? 'decimal' : undefined}
                        placeholder={f.placeholder}
                        className={isInvalid ? 'border-red-500 h-10 rounded-md' : `${validBorder} ${focusClasses} h-10 rounded-md`}
                        aria-invalid={isInvalid || undefined}
                        value={(v as string) ?? ''} onChange={e => onChange(f.name, e.target.value)}
                        onBlur={() => handleBlur(f.name, f.type, v)} />
                    )
                  })()}
                  {blurErr && (
                    <div className="text-xs text-red-600">{blurErr}</div>
                  )}
                </div>
              </FieldReveal>
            )
          })}
          {(() => {
            const sv = g.items.find(f => f.address?.streetView)
            if (!sv) return null
            return (
              <div className="sm:col-span-2">
                <StreetViewImage
                  lat={(scope[sv.address!.lat ?? ''] as string | undefined)}
                  lng={(scope[sv.address!.lng ?? ''] as string | undefined)}
                  address={(scope[sv.name] as string | undefined) ?? undefined}
                />
              </div>
            )
          })()}
          {g.section && afterSection?.[g.section] && (
            <div className="sm:col-span-2">{afterSection[g.section]}</div>
          )}
        </Fragment>
      ))}
    </div>
  )
}
