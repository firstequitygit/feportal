import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getAppSettings } from '@/lib/app-settings'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const now = Date.now()

  // IMPORTANT: getUser() above may have refreshed (and, with rotation enabled, rotated) the
  // auth token, writing the new cookies onto `supabaseResponse`. Any response we return in
  // place of `supabaseResponse` (i.e. a redirect) MUST copy those cookies over. Otherwise
  // the browser keeps the old (now-rotated) refresh token, desyncs from the server, and
  // Supabase terminates the session prematurely. See the Supabase SSR middleware docs.
  const redirectTo = (path: string) => {
    const redirectResponse = NextResponse.redirect(new URL(path, request.url))
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  // Application-level session timeout. Supabase's native inactivity/timebox controls are a
  // Pro-plan feature, so we enforce it here with server-set httpOnly cookies (the timer
  // can't be tampered with from the browser). Limits come from app_settings so a super-admin
  // can adjust them without a deploy; getAppSettings caches for 30s.
  const settings = await getAppSettings()
  const IDLE_LIMIT_MS = settings.idle_timeout_hours * 60 * 60 * 1000
  const ABSOLUTE_LIMIT_MS = settings.absolute_session_hours * 60 * 60 * 1000
  const ACTIVITY_COOKIE = 'fe-last-activity'
  const START_COOKIE = 'fe-session-start'
  const EPOCH_COOKIE = 'fe-session-epoch'
  const trackingOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // outlive the idle window so the timer survives between requests
  }
  const clearTracking = (res: NextResponse) => {
    res.cookies.set(ACTIVITY_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set(START_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set(EPOCH_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set('fe_view_as', '', { path: '/', maxAge: 0 })
    return res
  }
  const stampActivity = (res: NextResponse, sessionStart: number) => {
    res.cookies.set(ACTIVITY_COOKIE, String(now), trackingOptions)
    res.cookies.set(START_COOKIE, String(sessionStart || now), trackingOptions)
    res.cookies.set(EPOCH_COOKIE, String(settings.session_epoch), trackingOptions)
    return res
  }

  // Unauthenticated: send to login (API routes handle their own auth) and reset the timer.
  // /apply and /broker/apply are public loan-application intakes — must not be
  // gated. /authorize is also public; it slips through via the /auth prefix.
  if (!user) {
    if (
      !pathname.startsWith('/login') &&
      !pathname.startsWith('/auth') &&
      !pathname.startsWith('/api/') &&
      !pathname.startsWith('/apply') &&
      !pathname.startsWith('/broker/apply')
    ) {
      return clearTracking(redirectTo('/login'))
    }
    return clearTracking(supabaseResponse)
  }

  // Authenticated: enforce idle + absolute session limits.
  const lastActivity = Number(request.cookies.get(ACTIVITY_COOKIE)?.value) || 0
  const sessionStart = Number(request.cookies.get(START_COOKIE)?.value) || 0
  const cookieEpoch = request.cookies.get(EPOCH_COOKIE)?.value
  const idleExpired = lastActivity > 0 && now - lastActivity > IDLE_LIMIT_MS
  const absoluteExpired = sessionStart > 0 && now - sessionStart > ABSOLUTE_LIMIT_MS
  // Force-logout works by bumping settings.session_epoch. If the cookie was set by an
  // earlier epoch, the session is invalid. We allow the very first authenticated request
  // through (no cookie yet) so login can stamp the current epoch.
  const epochMismatch = cookieEpoch !== undefined && cookieEpoch !== String(settings.session_epoch)

  if (idleExpired || absoluteExpired || epochMismatch) {
    // Sign out this browser only (scope 'local' leaves the user's other devices alone).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    const reason = epochMismatch ? 'logged_out' : 'timeout'
    const res = NextResponse.redirect(new URL(`/login?reason=${reason}`, request.url))
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie))
    return clearTracking(res)
  }

  // Authenticated users shouldn't sit on /login.
  if (pathname === '/login') {
    return stampActivity(redirectTo('/dashboard'), sessionStart)
  }

  return stampActivity(supabaseResponse, sessionStart)
}

export const config = {
  matcher: [
    // Skip Next.js internals, static files, AND all /api/ routes
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
