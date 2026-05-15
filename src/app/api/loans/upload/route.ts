import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyContactAccess } from '@/lib/contact-access'

// Step 1: Returns a signed upload URL so the browser can upload directly to Supabase
// (bypasses Vercel's 4.5 MB body size limit)
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { loanId, conditionId, fileName, conditionTitle, propertyAddress } = await req.json()

  if (!loanId || !conditionId || !fileName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Accept either the borrower OR the broker on this loan
  const access = await verifyContactAccess(user.id, loanId)
  if (!access) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

  const adminClient = createAdminClient()

  // Verify condition belongs to loan
  const { data: condition } = await adminClient
    .from('conditions')
    .select('id')
    .eq('id', conditionId)
    .eq('loan_id', loanId)
    .single()

  if (!condition) return NextResponse.json({ error: 'Condition not found' }, { status: 404 })

  function slugify(str: string): string {
    return str.trim().replace(/[^a-zA-Z0-9\s\-]/g, '').replace(/\s+/g, '_').substring(0, 60)
  }

  const addressSlug = slugify(propertyAddress ?? loanId)
  const conditionSlug = slugify(conditionTitle ?? conditionId)
  const ext = fileName.split('.').pop()
  const baseName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\s\-]/g, '').replace(/\s+/g, '_').substring(0, 40)
  const path = `${addressSlug}/${conditionSlug}/${Date.now()}_${baseName}.${ext}`

  const { data, error } = await adminClient.storage
    .from('documents')
    .createSignedUploadUrl(path)

  if (error || !data) {
    console.error('Signed URL error:', error)
    return NextResponse.json({ error: 'Could not create upload URL: ' + error?.message }, { status: 500 })
  }

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path })
}
