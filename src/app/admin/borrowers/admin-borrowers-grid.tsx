'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DataGrid, type DataGridColumn, EditableCell } from '@/components/data-grid'

export interface AdminBorrowerRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  created_at: string | null
  has_auth: boolean
  loan_count: number
  loan_officers: string[]
}

export function AdminBorrowersGrid({ initialRows }: { initialRows: AdminBorrowerRow[] }) {
  const [rows, setRows] = useState(initialRows)

  async function patch(id: string, field: 'full_name' | 'email' | 'phone', value: string | null): Promise<true | { error: string }> {
    const row = rows.find(r => r.id === id)
    if (!row) return { error: 'Row not found' }
    const res = await fetch('/api/admin/borrowers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        full_name: field === 'full_name' ? value : row.full_name,
        email: field === 'email' ? value : row.email,
        phone: field === 'phone' ? value : row.phone,
      }),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error ?? 'Save failed' }
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
    return true
  }

  async function handleDelete(row: AdminBorrowerRow) {
    const name = row.full_name ?? row.email
    const loanWarning = row.loan_count > 0
      ? `\n\nThey are currently on ${row.loan_count} loan${row.loan_count === 1 ? '' : 's'} — their slot will be cleared (loans stay intact).`
      : ''
    if (!confirm(`Delete borrower ${name}?${loanWarning}\n\nThis also removes their portal login. This can't be undone.`)) return

    const res = await fetch('/api/admin/borrowers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id }),
    })
    const data = await res.json()
    if (data.success) {
      setRows(prev => prev.filter(r => r.id !== row.id))
      toast.success(`${name} deleted`)
    } else {
      toast.error(data.error ?? 'Delete failed')
    }
  }

  const columns: DataGridColumn<AdminBorrowerRow>[] = [
    {
      id: 'full_name', label: 'Name', filterKind: 'contains', alwaysVisible: true,
      accessor: (r) => r.full_name ?? '',
      cell: (r) => (
        <EditableCell type="text" value={r.full_name} placeholder="—"
          onSave={(v) => patch(r.id, 'full_name', v)} />
      ),
      width: 'w-56',
    },
    {
      id: 'email', label: 'Email', filterKind: 'contains',
      accessor: (r) => r.email,
      cell: (r) => (
        <EditableCell type="email" value={r.email}
          readOnly={r.has_auth}
          onSave={(v) => patch(r.id, 'email', v)} />
      ),
      width: 'w-64',
    },
    {
      id: 'phone', label: 'Phone', filterKind: 'contains',
      accessor: (r) => r.phone ?? '',
      cell: (r) => (
        <EditableCell type="phone" value={r.phone}
          onSave={(v) => patch(r.id, 'phone', v)} />
      ),
      width: 'w-40',
    },
    {
      id: 'loan_count', label: 'Loans', filterKind: 'range',
      accessor: (r) => r.loan_count,
      cell: (r) => <span className="text-sm tabular-nums">{r.loan_count}</span>,
      width: 'w-20',
    },
    {
      id: 'loan_officers', label: 'Loan Officer', filterKind: 'contains',
      accessor: (r) => r.loan_officers.join(', '),
      cell: (r) => (
        <span className="text-sm text-gray-700">
          {r.loan_officers.length === 0 ? <span className="text-gray-400">—</span> : r.loan_officers.join(', ')}
        </span>
      ),
      width: 'w-48',
    },
    {
      id: 'has_auth', label: 'Status', filterKind: 'multi',
      filterOptions: [{ label: 'Active', value: 'active' }, { label: 'Invited', value: 'invited' }],
      accessor: (r) => r.has_auth ? 'active' : 'invited',
      cell: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${r.has_auth ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {r.has_auth ? 'Active' : 'Invited'}
        </span>
      ),
      width: 'w-24',
    },
    {
      id: 'created_at', label: 'Created', filterKind: 'none',
      accessor: (r) => r.created_at ?? '',
      cell: (r) => <span className="text-sm text-gray-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</span>,
      width: 'w-32',
    },
    {
      id: 'actions', label: '', sortable: false, filterKind: 'none', alwaysVisible: true,
      accessor: () => '',
      cell: (r) => (
        <button
          type="button"
          onClick={() => handleDelete(r)}
          className="text-gray-400 hover:text-red-600 p-1"
          aria-label="Delete borrower"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      ),
      width: 'w-12',
    },
  ]

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      defaultVisibleColumns={['full_name', 'email', 'phone', 'loan_count', 'loan_officers', 'has_auth', 'actions']}
      rowHref={(r) => `/admin/borrowers/${r.id}`}
      emptyState="No borrowers yet."
    />
  )
}
