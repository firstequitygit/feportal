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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        title="View as another user (Cmd/Ctrl+K)"
      >
        <Eye className="w-3.5 h-3.5" />
        View as
        <kbd className="ml-1 hidden sm:inline text-xs text-gray-400">⌘K</kbd>
      </button>
      <AdminViewAsModal open={open} onOpenChange={setOpen} />
    </>
  )
}
