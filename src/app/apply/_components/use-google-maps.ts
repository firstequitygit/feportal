"use client"
import { useEffect, useState } from "react"

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

// Module-level singleton so the script is injected only once across all
// component mounts, even if multiple AddressAutocomplete components mount
// simultaneously.
let loaderPromise: Promise<void> | null = null

function loadGoogleMapsScript(): Promise<void> {
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise<void>((resolve, reject) => {
    if (typeof window !== "undefined" && window.google?.maps?.places) {
      resolve()
      return
    }

    const existing = document.querySelector(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    )
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", reject)
      return
    }

    const script = document.createElement("script")
    // v=weekly pins to the latest stable release, which is required for
    // the Places API (New) classes (AutocompleteSuggestion, etc.).
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places&loading=async&v=weekly`
    script.async = true
    script.defer = true
    script.addEventListener("load", () => resolve())
    script.addEventListener("error", reject)
    document.head.appendChild(script)
  })

  return loaderPromise
}

export type GoogleMapsState =
  | { loaded: false; available: false }
  | { loaded: false; available: true }
  | { loaded: true; available: true }

/**
 * Loads the Google Maps JS SDK (with the Places library) exactly once per page.
 * Returns `available: false` immediately when the API key env var is absent -
 * no script is injected in that case, so all address inputs degrade to plain
 * text inputs with zero console errors.
 */
export function useGoogleMaps(): GoogleMapsState {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!API_KEY) return

    if (typeof window !== "undefined" && window.google?.maps?.places) {
      setLoaded(true)
      return
    }

    let cancelled = false
    loadGoogleMapsScript()
      .then(() => {
        if (!cancelled) setLoaded(true)
      })
      .catch(() => {
        loaderPromise = null
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!API_KEY) return { loaded: false, available: false }
  return { loaded, available: true }
}
