// Best-effort in-memory limiter (per warm serverless instance). Good enough
// to blunt abuse on public endpoints; not a security boundary on its own.
const hits = new Map<string, { count: number; reset: number }>()

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
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
