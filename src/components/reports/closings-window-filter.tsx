'use client'

import { useRouter, usePathname } from 'next/navigation'

interface Props {
  current: string  // '12' | '24' | '36' | 'all'
}

const OPTIONS: { value: string; label: string }[] = [
  { value: '12',  label: 'Last 12 months' },
  { value: '24',  label: 'Last 24 months' },
  { value: '36',  label: 'Last 36 months' },
  { value: 'all', label: 'All time' },
]

export function ClosingsWindowFilter({ current }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <span className="text-xs font-medium text-gray-500">Window:</span>
      {OPTIONS.map(o => (
        <button
          key={o.value}
          onClick={() => router.push(`${pathname}?months=${o.value}`)}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            o.value === current
              ? 'border-primary bg-primary text-white'
              : 'border-gray-200 text-gray-600 hover:border-primary/40'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
