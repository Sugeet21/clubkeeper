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
  // v20+ (#127): GameTable.id is a UUID **string** (Post-v20 ID law). Optional
  // for back-compat with pre-P1b mirrored rows that carry no id — treat a
  // missing/empty id as opaque and filter it out at the booking boundary
  // (validity = non-empty string). Never `Number()` it — Pattern R5/D12.
  id?: string
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
