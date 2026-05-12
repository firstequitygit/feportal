'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  title: React.ReactNode
  defaultOpen?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Card with a click-to-toggle header. Body collapses to hide the children
 * while keeping the title row visible. Defaults to open.
 */
export function CollapsibleCard({ title, defaultOpen = false, className, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className={className}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full text-left"
      >
        <CardHeader className="flex flex-row items-center justify-between gap-3 hover:bg-gray-50 transition-colors rounded-t-lg">
          <CardTitle className="text-base">{title}</CardTitle>
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${open ? '' : '-rotate-90'}`}
          />
        </CardHeader>
      </button>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  )
}
