import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from '@/lib/impersonate'
import { getLoanRoleForUser, canBulkUpload } from '@/lib/loan-authorization'

export async function POST(req: NextRequest) {
  const block = await assertNotImpersonating()
  if (block) return block
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { loanId, fileNames } = await req.json()
  if (!loanId || !Array.isArray(fileNames) || fileNames.length === 0) {
    return NextResponse.json({ error: 'Missing loanId or fileNames' }, { status: 400 })
  }
  if (fileNames.length > 50) {
    return NextResponse.json({ error: 'Too many files (max 50 per batch)' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const role = await getLoanRoleForUser(adminClient, loanId, user.id)
  if (!canBulkUpload(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: loan } = await adminClient
    .from('loans')
    .select('id, property_address')
    .eq('id', loanId)
    .single()
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  function slugify(s: string): string {
    return s.trim().replace(/[^a-zA-Z0-9\s\-]/g, '').replace(/\s+/g, '_').substring(0, 60)
  }

  const addressSlug = slugify(loan.property_address ?? loanId)
  const stamp = Date.now()

  const results: { fileName: string; path: string; signedUrl: string; token: string }[] = []
  for (let i = 0; i < fileNames.length; i++) {
    const original: string = String(fileNames[i])
    const ext = original.includes('.') ? original.split('.').pop() : ''
    const baseName = original.replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9\s\-]/g, '').replace(/\s+/g, '_').substring(0, 40)
    const path = `${addressSlug}/__unmatched/${stamp}_${i}_${baseName}${ext ? '.' + ext : ''}`
    const { data, error } = await adminClient.storage
      .from('documents')
      .createSignedUploadUrl(path)
    if (error || !data) {
      return NextResponse.json({ error: `Sign URL failed for "${original}": ${error?.message}` }, { status: 500 })
    }
    results.push({ fileName: original, path, signedUrl: data.signedUrl, token: data.token })
  }

  return NextResponse.json({ uploads: results })
}
