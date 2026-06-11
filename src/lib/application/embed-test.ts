// Embed test mode unlock.
//
// When an application form runs inside the WordPress iframe it is cross-site,
// so the admin Supabase session cookie is third-party and never reaches the
// server. The normal cookie-based admin check that gates test mode therefore
// can't see it. A shared secret (EMBED_TEST_KEY) provides a cookieless unlock:
// the embed URL carries a matching ?testkey, the apply page uses it to render
// the test toggle, and the test-submit routes accept it as an x-embed-test-key
// header in lieu of the session cookie.
//
// Same helper guards both the borrower (/apply) and broker (/broker/apply)
// variants. Keep the secret URL off public pages; the WordPress snippet
// forwards it from the parent page URL so it never lives in public HTML.
export function isValidEmbedTestKey(candidate: string | null | undefined): boolean {
  const key = process.env.EMBED_TEST_KEY ?? ''
  return key.length > 0 && candidate === key
}
