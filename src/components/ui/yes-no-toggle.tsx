'use client'
import { cn } from "@/lib/utils"

export interface YesNoToggleProps {
  value: boolean | undefined
  onChange: (next: boolean) => void
  invalid?: boolean
  id?: string
  name?: string
}

export function YesNoToggle({ value, onChange, invalid, id, name }: YesNoToggleProps) {
  return (
    <div
      role="radiogroup"
      id={id}
      aria-invalid={invalid || undefined}
      className={cn(
        "inline-flex w-full max-w-xs rounded-md border bg-gray-100 p-1",
        invalid ? "border-red-500" : "border-gray-200"
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === true}
        name={name}
        onClick={() => onChange(true)}
        className={cn(
          "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
          value === true
            ? "bg-white text-[#1F5D8F] shadow-sm"
            : "text-gray-600 hover:text-gray-900"
        )}
      >
        Yes
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === false}
        name={name}
        onClick={() => onChange(false)}
        className={cn(
          "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
          value === false
            ? "bg-white text-[#1F5D8F] shadow-sm"
            : "text-gray-600 hover:text-gray-900"
        )}
      >
        No
      </button>
    </div>
  )
}
