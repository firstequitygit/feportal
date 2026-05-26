// Pure RNG helpers for /apply test mode. No external deps.

const FIRST_NAMES = [
  'Alex','Jordan','Taylor','Morgan','Casey','Riley','Avery','Quinn','Reese','Drew',
  'Sam','Charlie','Robin','Pat','Skyler','Jamie','Rowan','Hayden','Logan','Cameron',
] as const
const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez',
  'Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore',
] as const

interface AddressSample {
  street: string
  city: string
  state: string
  zip: string
}

// Hand-curated real city/state/zip triples to keep PDFs and address autocomplete-free renders sensible.
const ADDRESS_SAMPLES: AddressSample[] = [
  { street: '123 Maple Ave',   city: 'Sea Girt',     state: 'NJ', zip: '08750' },
  { street: '45 Ocean Blvd',   city: 'Asbury Park',  state: 'NJ', zip: '07712' },
  { street: '812 Pine St',     city: 'Toms River',   state: 'NJ', zip: '08753' },
  { street: '210 Elm Rd',      city: 'Red Bank',     state: 'NJ', zip: '07701' },
  { street: '57 Hudson St',    city: 'Hoboken',      state: 'NJ', zip: '07030' },
  { street: '99 Park Ave',     city: 'New York',     state: 'NY', zip: '10016' },
  { street: '404 Atlantic Ave',city: 'Brooklyn',     state: 'NY', zip: '11217' },
  { street: '300 Spruce Ln',   city: 'Stamford',     state: 'CT', zip: '06902' },
  { street: '88 Beach Rd',     city: 'Miami',        state: 'FL', zip: '33139' },
  { street: '15 Sunset Dr',    city: 'Tampa',        state: 'FL', zip: '33606' },
]

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function randomName(): { first: string; middle: string; last: string } {
  return {
    first: pick(FIRST_NAMES),
    middle: pick(FIRST_NAMES).slice(0, 1),
    last: pick(LAST_NAMES),
  }
}

export function randomAddress(): AddressSample {
  // Randomize the house number so re-runs aren't identical.
  const base = pick(ADDRESS_SAMPLES)
  const num = 100 + Math.floor(Math.random() * 9000)
  const streetTail = base.street.replace(/^\d+\s+/, '')
  return { ...base, street: `${num} ${streetTail}` }
}

export function randomCurrency(min: number, max: number, step = 1000): number {
  const range = Math.max(0, max - min)
  const v = min + Math.floor(Math.random() * (range / step + 1)) * step
  return v
}

export function randomDate(daysBack: number): string {
  // Returns YYYY-MM-DD anywhere in the past `daysBack` days (inclusive).
  const t = Date.now() - Math.floor(Math.random() * daysBack) * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export function randomDOB(minAge = 28, maxAge = 65): string {
  // Returns YYYY-MM-DD for an adult between minAge and maxAge.
  const years = minAge + Math.floor(Math.random() * (maxAge - minAge + 1))
  const ms = Date.now() - years * 365.25 * 86_400_000 - Math.floor(Math.random() * 365) * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export function randomSSN(): string {
  // 9 digits, formatted XXX-XX-XXXX. Avoid 000 area, 00 group, 0000 serial per real-world SSN rules.
  const area = 100 + Math.floor(Math.random() * 800)
  const group = 10 + Math.floor(Math.random() * 90)
  const serial = 1000 + Math.floor(Math.random() * 9000)
  return `${area}-${group}-${serial}`
}

export function randomPhone(): string {
  // (NXX) NXX-XXXX where N is 2-9.
  const a = 2 + Math.floor(Math.random() * 8)
  const b = 100 + Math.floor(Math.random() * 900)
  const c = 2 + Math.floor(Math.random() * 8)
  const d = 100 + Math.floor(Math.random() * 900)
  const e = 1000 + Math.floor(Math.random() * 9000)
  return `(${a}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}) ${c}${b.toString().slice(0, 2)}-${e.toString().slice(0, 4)}${d.toString().slice(0, 0)}`.replace(/\s+/g, ' ').trim()
}

export function randomEmail(first: string, last: string): string {
  const suffix = Math.floor(Math.random() * 1000)
  return `${first}.${last}${suffix}@example.com`.toLowerCase()
}
