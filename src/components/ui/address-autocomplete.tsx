"use client"
import { useEffect, useRef } from "react"
import { useGoogleMaps } from "@/app/apply/_components/use-google-maps"

// Shared styling constants matching field-renderer.tsx
const focusClasses =
  "focus:outline-none focus:ring-2 focus:ring-[#1F5D8F]/40 focus:border-[#1F5D8F]"
const baseClasses =
  "w-full rounded-md border bg-white px-3 py-2.5 text-sm transition-colors outline-none disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"

export interface PlaceParts {
  street: string
  city: string
  state: string
  zip: string
  lat?: string
  lng?: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  onPlaceSelected: (parts: PlaceParts) => void
  invalid?: boolean
  id?: string
  placeholder?: string
}

function getComponent(
  components: google.maps.GeocoderAddressComponent[],
  type: string,
  format: "long_name" | "short_name" = "long_name"
): string {
  return components.find((c) => c.types.includes(type))?.[format] ?? ""
}

export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  invalid = false,
  id,
  placeholder,
}: Props) {
  const { loaded } = useGoogleMaps()
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null)

  useEffect(() => {
    if (!loaded || !inputRef.current) return

    // Instantiate the classic Autocomplete widget
    autocompleteRef.current = new window.google.maps.places.Autocomplete(
      inputRef.current,
      {
        types: ["address"],
        componentRestrictions: { country: "us" },
        fields: ["address_components", "geometry", "formatted_address"],
      }
    )

    listenerRef.current = autocompleteRef.current.addListener(
      "place_changed",
      () => {
        const place = autocompleteRef.current!.getPlace()
        if (!place.address_components) return

        const comps = place.address_components
        const streetNumber = getComponent(comps, "street_number")
        const route = getComponent(comps, "route")
        const street = [streetNumber, route].filter(Boolean).join(" ")
        const city =
          getComponent(comps, "locality") ||
          getComponent(comps, "sublocality")
        const state = getComponent(
          comps,
          "administrative_area_level_1",
          "short_name"
        )
        const zip = getComponent(comps, "postal_code")

        const lat = place.geometry?.location?.lat()?.toString()
        const lng = place.geometry?.location?.lng()?.toString()

        onPlaceSelected({ street, city, state, zip, lat, lng })
      }
    )

    return () => {
      listenerRef.current?.remove()
      listenerRef.current = null
      // The Autocomplete widget does not expose a destroy method; it cleans up
      // its own DOM (the pac-container) when detached.
      autocompleteRef.current = null
    }
    // Re-attach only when the script finishes loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const borderClass = invalid
    ? "border-red-500"
    : `border-gray-300 ${focusClasses}`

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      autoComplete="off"
      placeholder={placeholder}
      className={`${baseClasses} ${borderClass}`}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
