import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: lp } = await adminClient
    .from('loan_processors').select('id').eq('auth_user_id', user.id).single()
  if (!lp) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { loanId, conditionId, fileName, conditionTitle, propertyAddress } = await req.json()
  if (!loanId || !conditionId || !fileName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data: loan } = await adminClient
    .from('loans').select('id').eq('id', loanId).eq('loan_processor_id', lp.id).single()
  if (!loan) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    return NextResponse.json({ error: 'Could not create upload URL: ' + error?.message }, { status: 500 })
  }

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path })
}
