"use client"
import { useState } from "react"

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

interface Props {
  lat?: string
  lng?: string
  address?: string
}

/**
 * Renders a Google Street View Static API image for the given coordinates.
 * Returns null when the API key is absent, when neither lat/lng nor address
 * is provided, or when the Street View image fails to load.
 */
export function StreetViewImage({ lat, lng, address }: Props) {
  const [errored, setErrored] = useState(false)

  if (!API_KEY) return null

  const hasLatLng = lat && lng
  const hasAddress = Boolean(address)
  if (!hasLatLng && !hasAddress) return null
  if (errored) return null

  const location = hasLatLng
    ? `${lat},${lng}`
    : encodeURIComponent(address!)

  const src = `https://maps.googleapis.com/maps/api/streetview?size=600x300&location=${location}&key=${API_KEY}`

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-gray-200">
      <img
        src={src}
        alt={`Street view of ${address ?? `${lat}, ${lng}`}`}
        className="w-full object-cover"
        onError={() => setErrored(true)}
      />
      <p className="px-3 py-1.5 text-xs text-gray-500">
        Street view of the subject property
      </p>
    </div>
  )
}
