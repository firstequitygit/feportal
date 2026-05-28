'use client'

import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { AdminViewAsModal } from '@/components/admin-view-as-modal'

/**
 * Header button that opens the View-As modal. Also listens for the
 * Cmd/Ctrl+K keyboard shortcut. Render this only when the current user
 * is an admin AND not already impersonating.
 */
export function AdminViewAsTrigger() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5 text-xs font-medium shadow-sm">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-zinc-600 transition-colors hover:bg-zinc-100"
          title="View as another user (Cmd/Ctrl+K)"
        >
          <Eye className="w-3.5 h-3.5" />
          View as
          <kbd className="ml-1 hidden sm:inline text-zinc-400">⌘K</kbd>
        </button>
      </div>
      <AdminViewAsModal open={open} onOpenChange={setOpen} />
    </>
  )
}
