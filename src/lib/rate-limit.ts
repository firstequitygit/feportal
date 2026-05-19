// Best-effort in-memory limiter (per warm serverless instance). Good enough
// to blunt abuse on public endpoints; not a security boundary on its own.
const hits = new Map<string, { count: number; reset: number }>()

let sweepCounter = 0
function maybeSweep(now: number) {
  if (++sweepCounter < 500) return
  sweepCounter = 0
  for (const [k, v] of hits) {
    if (now > v.reset) hits.delete(k)
  }
}

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  maybeSweep(now)
  const rec = hits.get(key)
  if (!rec || now > rec.reset) {
    hits.set(key, { count: 1, reset: now + windowMs })
    return true
  }
  if (rec.count >= max) return false
  rec.count++
  return true
}

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  return xff ? xff.split(',')[0].trim() : 'unknown'
}
