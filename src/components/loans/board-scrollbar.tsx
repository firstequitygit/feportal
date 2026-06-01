'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

interface Props {
  /** Ref to the horizontally-scrolling board container. */
  boardRef: RefObject<HTMLDivElement | null>
}

/**
 * Sticky horizontal scrollbar pinned to the bottom of the viewport.
 *
 * Mirrors the scroll position of `boardRef`. Visible whenever the board's
 * scrollWidth exceeds its clientWidth. Hidden otherwise.
 */
export function BoardScrollbar({ boardRef }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const syncingRef = useRef(false)
  const [overflow, setOverflow] = useState<{ visible: boolean; scrollWidth: number }>({
    visible: false,
    scrollWidth: 0,
  })

  useEffect(() => {
    const board = boardRef.current
    if (!board) return

    const measure = () => {
      const scrollWidth = board.scrollWidth
      const clientWidth = board.clientWidth
      setOverflow({
        visible: scrollWidth > clientWidth + 1,
        scrollWidth,
      })
    }
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(board)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [boardRef])

  useEffect(() => {
    const board = boardRef.current
    const track = trackRef.current
    if (!board || !track) return

    const onBoardScroll = () => {
      if (syncingRef.current) return
      syncingRef.current = true
      track.scrollLeft = board.scrollLeft
      requestAnimationFrame(() => {
        syncingRef.current = false
      })
    }
    const onTrackScroll = () => {
      if (syncingRef.current) return
      syncingRef.current = true
      board.scrollLeft = track.scrollLeft
      requestAnimationFrame(() => {
        syncingRef.current = false
      })
    }

    board.addEventListener('scroll', onBoardScroll, { passive: true })
    track.addEventListener('scroll', onTrackScroll, { passive: true })
    return () => {
      board.removeEventListener('scroll', onBoardScroll)
      track.removeEventListener('scroll', onTrackScroll)
    }
  }, [boardRef])

  if (!overflow.visible) return null

  return (
    <div className="hidden sm:block fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
      <div
        ref={trackRef}
        className="pointer-events-auto mx-auto overflow-x-auto overflow-y-hidden bg-white/85 backdrop-blur border-t border-gray-200 shadow-[0_-1px_2px_rgba(0,0,0,0.04)]"
        style={{ height: 14 }}
      >
        <div style={{ width: overflow.scrollWidth, height: 1 }} />
      </div>
    </div>
  )
}
