import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const RETENTION_DAYS = 90

// Runs nightly via Vercel cron. Deletes documents older than 90 days
// from both Supabase Storage and the documents table.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const adminClient = createAdminClient()

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)

    // Fetch all documents older than the cutoff
    const { data: oldDocs, error: fetchError } = await adminClient
      .from('documents')
      .select('id, file_path')
      .lt('created_at', cutoff.toISOString())

    if (fetchError) {
      console.error('Cleanup fetch error:', fetchError.message)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!oldDocs || oldDocs.length === 0) {
      console.log('Document cleanup: nothing to delete')
      return NextResponse.json({ success: true, deleted: 0 })
    }

    const paths = oldDocs.map(d => d.file_path)

    // Delete files from Supabase Storage
    const { error: storageError } = await adminClient.storage
      .from('documents')
      .remove(paths)

    if (storageError) {
      console.error('Storage deletion error:', storageError.message)
      // Continue anyway — still remove DB records so they don't pile up
    }

    // Delete records from the database
    const ids = oldDocs.map(d => d.id)
    const { error: dbError } = await adminClient
      .from('documents')
      .delete()
      .in('id', ids)

    if (dbError) {
      console.error('DB deletion error:', dbError.message)
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    console.log(`Document cleanup: deleted ${oldDocs.length} documents older than ${RETENTION_DAYS} days`)
    return NextResponse.json({ success: true, deleted: oldDocs.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Document cleanup error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
