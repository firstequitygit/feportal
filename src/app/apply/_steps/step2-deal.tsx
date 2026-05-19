'use client'
import { DEAL_FIELDS, type ApplicationData } from '@/lib/application-fields'
import { FieldRenderer } from '../_components/field-renderer'
import { RepeatingUnits } from '../_components/repeating-units'

export function Step2Deal({ data, set }: {
  data: ApplicationData; set: (patch: Record<string, unknown>) => void
}) {
  return (
    <div className="space-y-6">
      <FieldRenderer fields={DEAL_FIELDS} data={data} scope={data} onChange={(n, v) => set({ [n]: v })} />
      <RepeatingUnits data={data} set={set} />
    </div>
  )
}
