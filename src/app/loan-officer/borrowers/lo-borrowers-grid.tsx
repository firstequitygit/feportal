'use client'

import { useState } from 'react'
import { DataGrid, type DataGridColumn, EditableCell } from '@/components/data-grid'

export interface LoBorrowerRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  loan_count: number
  most_recent_loan_id: string | null
  last_loan_stage: string | null
  last_loan_activity: string | null
}

export function LoBorrowersGrid({ initialRows }: { initialRows: LoBorrowerRow[] }) {
  const [rows, setRows] = useState(initialRows)

  async function patch(id: string, field: 'full_name' | 'email' | 'phone', value: string | null): Promise<true | { error: string }> {
    const row = rows.find(r => r.id === id)
    if (!row) return { error: 'Row not found' }
    const res = await fetch('/api/loan-officer/borrowers', {
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

  const columns: DataGridColumn<LoBorrowerRow>[] = [
    {
      id: 'full_name', label: 'Name', filterKind: 'contains', alwaysVisible: true,
      accessor: (r) => r.full_name ?? '',
      cell: (r) => <EditableCell type="text" value={r.full_name} onSave={(v) => patch(r.id, 'full_name', v)} />,
      width: 'w-56',
    },
    {
      id: 'email', label: 'Email', filterKind: 'contains',
      accessor: (r) => r.email,
      cell: (r) => <EditableCell type="email" value={r.email} onSave={(v) => patch(r.id, 'email', v)} />,
      width: 'w-64',
    },
    {
      id: 'phone', label: 'Phone', filterKind: 'contains',
      accessor: (r) => r.phone ?? '',
      cell: (r) => <EditableCell type="phone" value={r.phone} onSave={(v) => patch(r.id, 'phone', v)} />,
      width: 'w-40',
    },
    {
      id: 'loan_count', label: 'Loans', filterKind: 'range',
      accessor: (r) => r.loan_count,
      cell: (r) => <span className="text-sm tabular-nums">{r.loan_count}</span>,
      width: 'w-20',
    },
    {
      id: 'last_loan_stage', label: 'Last stage', filterKind: 'contains',
      accessor: (r) => r.last_loan_stage ?? '',
      cell: (r) => <span className="text-sm text-gray-700">{r.last_loan_stage ?? '—'}</span>,
      width: 'w-40',
    },
    {
      id: 'last_loan_activity', label: 'Last activity', filterKind: 'none',
      accessor: (r) => r.last_loan_activity ?? '',
      cell: (r) => <span className="text-sm text-gray-500">{r.last_loan_activity ? new Date(r.last_loan_activity).toLocaleDateString() : '—'}</span>,
      width: 'w-32',
    },
  ]

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      defaultVisibleColumns={['full_name', 'email', 'phone', 'loan_count']}
      rowHref={(r) => r.most_recent_loan_id ? `/loan-officer/loans/${r.most_recent_loan_id}` : null}
      emptyState="No borrowers across your loans yet."
    />
  )
}
