import { cookies } from 'next/headers'
import type { ViewMode } from './types'

// Unsigned UI-preference cookie. Not authoritative: the server always
// verifies staff_users.is_admin before honoring mode='admin', so flipping
// this cookie alone grants no privilege. Distinct from fe_view_as
// (HMAC-signed View-As impersonation) — they coexist and don't overlap.
export const VIEW_MODE_COOKIE = 'fe_view_mode'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export async function readViewModeCookie(): Promise<ViewMode | null> {
  const jar = await cookies()
  const raw = jar.get(VIEW_MODE_COOKIE)?.value
  if (raw === 'admin' || raw === 'base') return raw
  return null
}

export async function writeViewModeCookie(mode: ViewMode): Promise<void> {
  const jar = await cookies()
  jar.set(VIEW_MODE_COOKIE, mode, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  })
}

export async function clearViewModeCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(VIEW_MODE_COOKIE)
}
