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

    // CHANGE_THRESHOLD: ignore sub-pixel jitter from sub-element reflows so
    // the parent does not get spammed (and we do not nudge the iframe height
    // by a few pixels in a way that could re-trigger the next reflow).
    // MAX_HEIGHT: hard ceiling. Real wizard content tops out around 3500px
    // on the busiest step; 6000 leaves ample margin while still capping any
    // pathological runaway.
    const CHANGE_THRESHOLD = 8
    const MAX_HEIGHT = 6000

    let last = 0
    const post = () => {
      const raw = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      )
      const h = Math.min(raw, MAX_HEIGHT)
      if (Math.abs(h - last) < CHANGE_THRESHOLD) return
      last = h
      window.parent.postMessage({ type: 'fef-apply-height', height: h }, '*')
    }

    post()
    const ro = new ResizeObserver(post)
    ro.observe(document.body)
    // 1s safety interval catches async DOM updates ResizeObserver misses
    // (e.g. images finishing load, lazy fonts settling).
    const t = setInterval(post, 1000)

    return () => {
      ro.disconnect()
      clearInterval(t)
    }
  }, [embed])

  return null
}
