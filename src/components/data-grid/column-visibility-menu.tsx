'use client'

import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export interface ColumnDef {
  id: string
  label: string
  alwaysVisible?: boolean
}

export interface ColumnVisibilityMenuProps {
  columns: ColumnDef[]
  visible: Set<string>
  defaults: string[]
  onChange: (next: string[]) => void
}

export function ColumnVisibilityMenu({
  columns,
  visible,
  defaults,
  onChange,
}: ColumnVisibilityMenuProps) {
  function toggle(id: string) {
    const col = columns.find(c => c.id === id)
    if (col?.alwaysVisible) return
    const next = new Set(visible)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(columns.filter(c => next.has(c.id) || c.alwaysVisible).map(c => c.id))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <Columns3 className="w-4 h-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map(c => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={visible.has(c.id)}
            onCheckedChange={() => toggle(c.id)}
            disabled={c.alwaysVisible}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChange(defaults)}>
          Reset to defaults
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
