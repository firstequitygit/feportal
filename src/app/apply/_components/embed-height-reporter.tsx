'use client'
import { useEffect } from "react"
import { useSearchParams } from "next/navigation"

/** When loaded with ?embed=1 (inside an iframe), watches document body height
 *  and posts changes to the parent window so the host page can auto-resize
 *  the iframe. The parent listens for `message` events of type
 *  'fef-apply-height' and updates the iframe's height attribute.
 *
 *  Posts to '*' rather than a specific origin because the host can be any
 *  page on firstequityfundingllc.com; the parent's message-event listener is
 *  what validates the origin on receipt. The payload is just a number, so a
 *  hostile parent reading it learns nothing sensitive. */
export function EmbedHeightReporter() {
  const searchParams = useSearchParams()
  const embed = searchParams.get('embed') === '1'

  useEffect(() => {
    if (!embed) return
    if (typeof window === 'undefined' || window.parent === window) return

    let last = 0
    const post = () => {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      )
      if (h !== last) {
        last = h
        window.parent.postMessage({ type: 'fef-apply-height', height: h }, '*')
      }
    }

    post()
    const ro = new ResizeObserver(post)
    ro.observe(document.body)
    const t = setInterval(post, 1000) // catch async updates ResizeObserver misses

    return () => {
      ro.disconnect()
      clearInterval(t)
    }
  }, [embed])

  return null
}
