import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { type ConditionStatus } from '@/lib/types'

const VALID_ACTIONS: Record<string, ConditionStatus> = {
  received:  'Received',
  satisfied: 'Satisfied',
  rejected:  'Rejected',
}

function htmlPage(title: string, message: string, color: string) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Desco Financial</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 48px 40px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { margin: 0 0 12px; font-size: 22px; color: #111; }
    p { margin: 0 0 24px; font-size: 15px; color: #555; line-height: 1.5; }
    a { display: inline-block; padding: 10px 24px; background: ${color}; color: #fff; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600; }
    a:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${color === '#16a34a' ? '✅' : color === '#dc2626' ? '❌' : '📥'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="https://portal.descofinancial.com/loan-processor">Go to Portal</a>
  </div>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  )
}

function errorPage(message: string) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Error — Desco Financial</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 48px 40px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    h1 { margin: 0 0 12px; font-size: 22px; color: #dc2626; }
    p { margin: 0; font-size: 15px; color: #555; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚠️ ${message}</h1>
    <p>Please log in to the portal to update this condition manually.</p>
  </div>
</body>
</html>`,
    { status: 400, headers: { 'Content-Type': 'text/html' } }
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token  = searchParams.get('token')
  const action = searchParams.get('action')?.toLowerCase()

  if (!token || !action) return errorPage('Missing token or action')

  const newStatus = VALID_ACTIONS[action]
  if (!newStatus) return errorPage('Invalid action')

  const adminClient = createAdminClient()

  // Look up the token
  const { data: tokenRow } = await adminClient
    .from('condition_action_tokens')
    .select('condition_id, loan_id, expires_at')
    .eq('token', token)
    .single()

  if (!tokenRow) return errorPage('Link not found or already expired')

  if (new Date(tokenRow.expires_at) < new Date()) {
    return errorPage('This link has expired')
  }

  // Fetch condition title for the confirmation message
  const { data: condition } = await adminClient
    .from('conditions')
    .select('title, status')
    .eq('id', tokenRow.condition_id)
    .single()

  if (!condition) return errorPage('Condition not found')

  // Update condition status
  const { error } = await adminClient
    .from('conditions')
    .update({ status: newStatus })
    .eq('id', tokenRow.condition_id)

  if (error) return errorPage('Failed to update condition')

  // Log event
  try {
    await adminClient.from('loan_events').insert({
      loan_id: tokenRow.loan_id,
      event_type: 'condition_updated',
      description: `Condition "${condition.title}" marked as ${newStatus} via email link`,
    })
  } catch (err) {
    console.error('Event log error:', err)
  }

  const colorMap: Record<string, string> = {
    Received:  '#2563eb',
    Satisfied: '#16a34a',
    Rejected:  '#dc2626',
  }

  return htmlPage(
    `Condition ${newStatus}`,
    `"${condition.title}" has been marked as <strong>${newStatus}</strong>.`,
    colorMap[newStatus] ?? '#6b7280'
  )
}
