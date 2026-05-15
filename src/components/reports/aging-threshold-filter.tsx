'use client'

import { useRouter, usePathname } from 'next/navigation'

interface Props {
  current: number
  options: number[]
}

export function AgingThresholdFilter({ current, options }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <span className="text-xs font-medium text-gray-500">Show loans in current stage longer than:</span>
      {options.map(n => (
        <button
          key={n}
          onClick={() => router.push(`${pathname}?days=${n}`)}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            n === current
              ? 'border-primary bg-primary text-white'
              : 'border-gray-200 text-gray-600 hover:border-primary/40'
          }`}
        >
          {n} days
        </button>
      ))}
    </div>
  )
}
