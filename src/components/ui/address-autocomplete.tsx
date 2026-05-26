"use client"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { MapPin } from "lucide-react"
import { useGoogleMaps } from "@/app/apply/_components/use-google-maps"

const focusClasses =
  "focus:outline-none focus:ring-2 focus:ring-[#1F5D8F]/40 focus:border-[#1F5D8F]"
const baseClasses =
  "h-10 w-full rounded-md border bg-white pl-10 pr-3 text-sm transition-colors outline-none disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"

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

interface Suggestion {
  placeId: string
  mainText: string
  secondaryText: string
  prediction: google.maps.places.PlacePrediction
}

function findComponent(
  components: google.maps.places.AddressComponent[] | null | undefined,
  type: string,
  useShort = false,
): string {
  if (!components) return ""
  const match = components.find((c) => c.types.includes(type))
  if (!match) return ""
  return (useShort ? match.shortText : match.longText) ?? ""
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
  const containerRef = useRef<HTMLDivElement>(null)
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const lastInputRef = useRef<string>("")

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const [resolving, setResolving] = useState(false)

  const listboxId = useId()

  const ensureSessionToken = useCallback(() => {
    if (!sessionTokenRef.current && loaded) {
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()
    }
    return sessionTokenRef.current
  }, [loaded])

  // Debounced fetch of autocomplete suggestions.
  useEffect(() => {
    if (!loaded) return
    // Don't refetch when the input change came from a place selection.
    if (value === lastInputRef.current) return
    lastInputRef.current = value

    if (!value || value.trim().length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }

    const handle = window.setTimeout(async () => {
      try {
        const token = ensureSessionToken()
        if (!token) return
        const { suggestions: results } =
          await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: value,
            sessionToken: token,
            includedRegionCodes: ["us"],
            includedPrimaryTypes: ["street_address", "premise", "subpremise"],
          })

        const mapped: Suggestion[] = []
        for (const s of results) {
          const p = s.placePrediction
          if (!p) continue
          mapped.push({
            placeId: p.placeId,
            mainText: p.mainText?.text ?? p.text.text,
            secondaryText: p.secondaryText?.text ?? "",
            prediction: p,
          })
        }
        setSuggestions(mapped)
        setOpen(mapped.length > 0)
        setActiveIndex(-1)
      } catch {
        setSuggestions([])
        setOpen(false)
      }
    }, 200)

    return () => window.clearTimeout(handle)
  }, [value, loaded, ensureSessionToken])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [open])

  async function selectSuggestion(s: Suggestion) {
    setOpen(false)
    setResolving(true)
    try {
      const place = s.prediction.toPlace()
      await place.fetchFields({
        fields: ["addressComponents", "location", "formattedAddress"],
      })

      const street = [
        findComponent(place.addressComponents, "street_number"),
        findComponent(place.addressComponents, "route"),
      ]
        .filter(Boolean)
        .join(" ")
      const city =
        findComponent(place.addressComponents, "locality") ||
        findComponent(place.addressComponents, "sublocality")
      const state = findComponent(
        place.addressComponents,
        "administrative_area_level_1",
        true,
      )
      const zip = findComponent(place.addressComponents, "postal_code")
      const lat = place.location?.lat()?.toString()
      const lng = place.location?.lng()?.toString()

      // Update the visible input first so the change isn't picked up as a
      // fresh autocomplete query (lastInputRef gate above).
      const displayStreet = street || s.mainText
      lastInputRef.current = displayStreet
      onChange(displayStreet)
      onPlaceSelected({ street: displayStreet, city, state, zip, lat, lng })

      // Place Details consumed the session token; mint a fresh one for the
      // next address the user might type in.
      sessionTokenRef.current = null
    } catch {
      // If details fetch fails, leave the input as-is and let the user
      // continue typing or pick a different suggestion.
    } finally {
      setResolving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault()
        selectSuggestion(suggestions[activeIndex])
      }
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  const borderClass = invalid
    ? "border-red-500"
    : `border-gray-300 ${focusClasses}`

  return (
    <div ref={containerRef} className="relative">
      <MapPin
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        aria-hidden
      />
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        className={`${baseClasses} ${borderClass}`}
        aria-invalid={invalid || undefined}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        role="combobox"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((s, i) => {
            const isActive = i === activeIndex
            return (
              <li
                key={s.placeId}
                role="option"
                aria-selected={isActive}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  isActive ? "bg-[#1F5D8F]/10 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                }`}
                onMouseDown={(e) => {
                  // mousedown (not click) so the input doesn't lose focus
                  // before we run the selection.
                  e.preventDefault()
                  selectSuggestion(s)
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <div className="font-medium">{s.mainText}</div>
                {s.secondaryText && (
                  <div className="text-xs text-gray-500">{s.secondaryText}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {resolving && (
        <p className="mt-1 text-xs text-gray-400">Loading address...</p>
      )}
    </div>
  )
}
