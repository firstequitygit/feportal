'use client'

import { forwardRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface SSNInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type' | 'inputMode'
  > {
  value: string
  onChange: (next: string) => void
  invalid?: boolean
}

function autoFormat(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9)
  if (digits.length <= 3) return digits
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

function mask(formatted: string): string {
  const digits = formatted.replace(/\D/g, '')
  if (digits.length < 9) return formatted
  return `XXX-XX-${digits.slice(5)}`
}

export const SSNInput = forwardRef<HTMLInputElement, SSNInputProps>(
  function SSNInput({ value, onChange, invalid, className, onFocus, onBlur, ...rest }, ref) {
    const [focused, setFocused] = useState(false)
    const displayed = focused ? value : mask(value)

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={displayed}
        placeholder="XXX-XX-XXXX"
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
