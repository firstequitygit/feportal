'use client'

import { useEffect, useRef, useState } from 'react'

export function FieldReveal({
  show,
  children,
}: {
  show: boolean
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = useState<string>(show ? 'none' : '0px')
  const [opacity, setOpacity] = useState<number>(show ? 1 : 0)
  const [mounted, setMounted] = useState<boolean>(show)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (show) {
      setMounted(true)
      const height = el.scrollHeight
      setMaxHeight(`${height}px`)
      setOpacity(1)
      const id = setTimeout(() => setMaxHeight('none'), 200)
      return () => clearTimeout(id)
    } else {
      setMaxHeight(`${el.scrollHeight}px`)
      requestAnimationFrame(() => {
        setMaxHeight('0px')
        setOpacity(0)
      })
      const id = setTimeout(() => setMounted(false), 200)
      return () => clearTimeout(id)
    }
  }, [show])

  if (!mounted && !show) return null

  return (
    <div
      ref={ref}
      style={{
        maxHeight,
        opacity,
        // Only clip during the slide animation. Once maxHeight is "none",
        // allow children to overflow (needed by absolute-positioned dropdowns
        // like the address autocomplete suggestions).
        overflow: maxHeight === 'none' ? 'visible' : 'hidden',
        transition: 'max-height 180ms ease, opacity 180ms ease',
      }}
    >
      {children}
    </div>
  )
}
