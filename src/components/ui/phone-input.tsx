'use client'

import { forwardRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface PhoneInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type' | 'inputMode'
  > {
  value: string
  onChange: (next: string) => void
  invalid?: boolean
}

/** Splits raw user input into the 10-digit US number and an optional extension.
 *  Extension begins after 10 digits, or once the user types 'x'/'ext'. */
function parse(raw: string): { digits: string; ext: string } {
  // Look for an explicit extension marker (x, ext) - everything after it is the ext.
  const extMatch = raw.match(/(?:x|ext\.?)\s*(\d*)/i)
  if (extMatch) {
    const main = raw.slice(0, extMatch.index).replace(/\D/g, '').slice(0, 10)
    return { digits: main, ext: extMatch[1] }
  }
  const allDigits = raw.replace(/\D/g, '')
  return { digits: allDigits.slice(0, 10), ext: allDigits.slice(10) }
}

/** Formats to `(732) 555-0100` with optional ` x1234` extension. */
function autoFormat(raw: string): string {
  const { digits, ext } = parse(raw)
  let formatted: string
  if (digits.length <= 3) formatted = digits
  else if (digits.length <= 6) formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  else formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (ext) return `${formatted} x${ext}`
  return formatted
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ value, onChange, invalid, className, onFocus, onBlur, ...rest }, ref) {
    const [focused, setFocused] = useState(false)
    // Value is stored already-formatted; re-run the formatter defensively so a
    // raw stored value (e.g. "7325550100") still displays nicely.
    const displayed = focused ? value : autoFormat(value)

    return (
      <input
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={displayed}
        placeholder="(732) 555-0100"
        onFocus={(e) => { setFocused(true); onFocus?.(e) }}
        onBlur={(e) => { setFocused(false); onBlur?.(e) }}
        onChange={(e) => onChange(autoFormat(e.target.value))}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-10 w-full rounded-md border bg-white px-3 text-sm outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
          invalid
            ? 'border-red-500'
            : 'border-gray-300 focus:border-[#1F5D8F] focus:ring-2 focus:ring-[#1F5D8F]/40',
          className,
        )}
        {...rest}
      />
    )
  },
)
