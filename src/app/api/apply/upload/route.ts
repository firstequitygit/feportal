import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Sanitize a filename: strip path separators, collapse repeated dots, keep extension.
function sanitizeFilename(raw: string): string {
  const stripped = raw.replace(/[/\\]/g, '').replace(/\.\./g, '').trim()
  // Keep only safe characters
  return stripped.replace(/[^a-zA-Z0-9.\-_ ]/g, '_').substring(0, 200) || 'file'
}

// POST: mint a signed upload URL for a public loan application draft.
// Body: { resumeToken: string, filename: string }
// Returns: { signedUrl, token, path }
export async function POST(req: NextRequest) {
  if (!rateLimit(`apply-upload:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { resumeToken?: string; filename?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { resumeToken, filename } = body
  if (!resumeToken || typeof resumeToken !== 'string') {
    return NextResponse.json({ error: 'Missing resumeToken' }, { status: 400 })
  }
  if (!filename || typeof filename !== 'string') {
    return NextResponse.json({ error: 'Missing filename' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Validate the token maps to an existing, not-yet-submitted draft.
  const { data: draft } = await admin
    .from('loan_applications')
    .select('id, status')
    .eq('resume_token', resumeToken)
    .maybeSingle()

  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.status === 'submitted') {
    return NextResponse.json({ error: 'Application already submitted' }, { status: 400 })
  }

  const safeFilename = sanitizeFilename(filename)
  const path = `apply/${resumeToken}/${crypto.randomUUID()}_${safeFilename}`

  const { data, error } = await admin.storage
    .from('documents')
    .createSignedUploadUrl(path)

  if (error || !data) {
    return NextResponse.json({ error: 'Could not create upload URL: ' + (error?.message ?? 'unknown') }, { status: 500 })
  }

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path })
}
