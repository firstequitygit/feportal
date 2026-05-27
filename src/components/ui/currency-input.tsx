'use client'

import { forwardRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface CurrencyInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type' | 'inputMode'
  > {
  value: string
  onChange: (next: string) => void
  invalid?: boolean
}

function formatWithCommas(raw: string): string {
  if (!raw) return ''
  const [whole, decimal] = raw.split('.')
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decimal !== undefined ? `${withCommas}.${decimal}` : withCommas
}

function stripToDigits(input: string): string {
  return input.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput({ value, onChange, invalid, className, onFocus, onBlur, ...rest }, ref) {
    const [focused, setFocused] = useState(false)
    const displayed = focused ? value : formatWithCommas(value)

    return (
      <div
        className={cn(
          'flex h-10 items-center rounded-md border bg-white transition-colors',
          invalid
            ? 'border-red-500'
            : 'border-gray-300 focus-within:border-[#1F5D8F] focus-within:ring-2 focus-within:ring-[#1F5D8F]/40',
          className,
        )}
      >
        <span className="pl-3 pr-1 text-gray-500 select-none">$</span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={displayed}
          onFocus={(e) => { setFocused(true); onFocus?.(e) }}
          onBlur={(e) => { setFocused(false); onBlur?.(e) }}
          onChange={(e) => onChange(stripToDigits(e.target.value))}
          aria-invalid={invalid || undefined}
          className="h-full w-full bg-transparent pr-3 text-right outline-none text-sm"
          {...rest}
        />
      </div>
    )
  },
)
