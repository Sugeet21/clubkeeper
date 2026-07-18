// Canonical Customer.phone format is '+91' + 10 digits (see src/types/customer.ts).
// Player-side flows carry BARE 10 digits (booking_intents.playerPhone, topup
// playerMobile — see src/types/booking.ts / src/types/playerHub.ts). Any code
// that looks up or creates a customer row from a player-supplied number MUST
// normalize through here — storing the raw form is bug #153 (duplicate customer
// + formattedPhone mangling the display).

// Normalize a player-supplied number to the canonical Customer.phone format.
// Unrecognized shapes pass through untouched (never invent digits).
export function toCustomerPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  return raw
}

// Dexie lookup candidates for a player-supplied number: the canonical form
// PLUS the legacy bare-10-digit form that pre-#153 booking flows wrote, so
// customers created under the old format stay reachable.
export function phoneLookupCandidates(raw: string): string[] {
  const canonical = toCustomerPhone(raw)
  const digits = raw.replace(/\D/g, '')
  const bare = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  return bare && bare !== canonical ? [canonical, bare] : [canonical]
}

// When both a canonical and a legacy row match, the canonical row wins —
// it's the one owner-side wallet flows created and topups credit into.
export function preferCanonicalPhone<T extends { phone: string | null }>(
  matches: T[],
  raw: string,
): T | undefined {
  const canonical = toCustomerPhone(raw)
  return matches.find((m) => m.phone === canonical) ?? matches[0]
}
