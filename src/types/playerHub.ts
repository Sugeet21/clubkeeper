export interface TopupIntent {
  id: string
  clubId: string
  playerName: string | null
  playerMobile: string        // 10 digits, no +91
  amount: number              // integer rupees
  status: 'pending' | 'confirmed' | 'rejected' | 'expired'
  rejectReason: string | null
  createdAt: string           // ISO timestamp from Supabase
  confirmedAt: string | null
}

import type { CoinTier, RateTier, GameType } from '.'

// Public-safe slim projection of an owner's active table. Never includes
// session data or owner-private fields. Includes `id` (the Dexie GameTable.id)
// since v17 booking needs the player to round-trip a table identifier back
// to the owner; the id is meaningless outside the owner's IndexedDB and
// carries no PII, so exposing it is safe.
// Mirrored to Supabase clubs.tables_json on owner-side table save.
export interface PublicTableInfo {
  id?: number                       // v17: optional for back-compat with rows mirrored pre-booking; treat missing as opaque
  name: string
  gameType: GameType
  ratePerHour: number
  ratePerFrame?: number
  rateCard?: RateTier[]
  toleranceMinutes?: number
  rateCardBilling?: 'minimum' | 'prorated'
}

export interface ClubPublicInfo {
  clubName: string
  upiId: string | null
  acceptsTopups: boolean
  coinsEnabled: boolean
  coinTiers: CoinTier[]
  tablesJson: PublicTableInfo[]
  acceptsPricingDisplay: boolean
  // v17 — advance booking (Phase 1 of #84)
  acceptsBookings: boolean
  /** @deprecated 22 Jun 2026 — replaced by bookingAdvancePerSlot (#106). */
  bookingAdvanceAmount: number     // ₹; default 100 if undefined on row
  // v19 (#106) — per-club operating hours + per-slot advance. null when the
  // club hasn't been configured yet OR the migration hasn't run on this row;
  // BookingScreen renders a "not configured" state and never falls back to
  // hardcoded hours.
  bookingOpenMinutes: number | null
  bookingCloseMinutes: number | null
  bookingAdvancePerSlot: number    // ₹; default 50 if undefined on row
}
