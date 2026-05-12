// Single source of truth for the portal's external URL.
// Set NEXT_PUBLIC_PORTAL_URL in Vercel to the production URL (vercel.app
// subdomain or eventual custom domain). Fallback is for local dev only.
export const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://feportal.vercel.app'
export const PORTAL_DOMAIN = PORTAL_URL.replace(/^https?:\/\//, '')
