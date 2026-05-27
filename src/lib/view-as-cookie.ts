import { createHmac, timingSafeEqual } from 'node:crypto'

export type ViewAsKind =
  | 'borrower' | 'broker'
  | 'loan_officer' | 'loan_processor' | 'underwriter'

export interface ViewAsCookiePayload {
  kind: ViewAsKind
  target_id: string
  admin_id: string
  started_at: string
}

export const VIEW_AS_COOKIE = 'fe_view_as'

function secret(): string {
  const s = process.env.VIEW_AS_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('VIEW_AS_SECRET (or SUPABASE_SERVICE_ROLE_KEY fallback) missing')
  return s
}

export function signViewAsCookie(payload: ViewAsCookiePayload): string {
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json, 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret()).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export function verifyViewAsCookie(value: string | undefined): ViewAsCookiePayload | null {
  if (!value) return null
  const [b64, sig] = value.split('.')
  if (!b64 || !sig) return null
  const expected = createHmac('sha256', secret()).update(b64).digest('base64url')
  const a = Buffer.from(sig, 'base64url')
  const b = Buffer.from(expected, 'base64url')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const obj = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
    if (
      obj && typeof obj === 'object' &&
      typeof obj.kind === 'string' && typeof obj.target_id === 'string' &&
      typeof obj.admin_id === 'string' && typeof obj.started_at === 'string'
    ) {
      return obj as ViewAsCookiePayload
    }
    return null
  } catch {
    return null
  }
}
