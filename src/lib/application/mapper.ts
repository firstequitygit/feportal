import { mapApplication as _mapApplication, type MappedApplication } from '@/lib/application-mapper'
import type { ApplicationData } from '@/lib/application-fields'

export type { MappedApplication, MappedBorrower } from '@/lib/application-mapper'

export interface MapOptions {
  variant?: 'borrower' | 'broker'
}

/** Variant-aware wrapper around the underlying pure mapper.
 *  Today both variants produce identical output; the variant param is plumbed
 *  through so PR 3 can branch (e.g. broker-specific deal title or pipeline). */
export function mapApplication(
  data: ApplicationData,
  _opts: MapOptions = { variant: 'borrower' },
): MappedApplication {
  return _mapApplication(data)
}
