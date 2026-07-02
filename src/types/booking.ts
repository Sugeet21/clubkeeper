import type { GameType } from '.'

// Booking — the owner-side permanent record of a confirmed player advance booking.
// Lives in Dexie (v17). Intent rows in Supabase are short-lived (<=24h); only
// confirmed-or-later rows ever cross to Dexie. 'pending' status NEVER appears
// here — pending lives ONLY in Supabase booking_intents (hybrid postbox model).
//
// `id` is the intent UUID carried over verbatim from Supabase booking_intents.id
// so the audit trail across both stores is intact.
export type BookingStatus = 'confirmed' | 'consumed' | 'no_show' | 'cancelled'

export interface Booking {
  id: string                       // = Supabase booking_intents.id (UUID)
  tableId: string                  // Dexie GameTable.id (UUID v20+) at the time of booking
  playerName: string | null
  playerPhone: string              // 10-digit Indian, validated upstream
  slotStart: number                // Unix ms — Pattern T1 / timestamps not counters
  slotEnd: number                  // Unix ms = slotStart + durationMin*60*1000
  durationMin: number              // integer minutes
  gameType: GameType
  tierPrice: number                // integer ₹ — the tier price shown to player at booking
  advanceAmount: number            // integer ₹ — the advance the player paid up-front
  status: BookingStatus
  consumedSessionId?: string       // set when status='consumed' — links to sessions.id (UUID v20+)
  confirmedAt: number              // Unix ms when owner confirmed
  notes?: string
  updatedAt?: number               // Phase C LWW metadata (#117) — epoch ms
  deletedAt?: number | null        // Phase C soft-delete marker (#117) — epoch ms
}

// Public-safe slim projection for the Supabase clubs row (mirrors topup pattern).
// Only the fields a player needs to construct a booking screen. Owner-side
// data (table.id, sessions, sortOrder, etc.) NEVER appears in this shape.
//
// NOTE: PublicTableInfo already covers this via Pricing Visibility (Phase 0).
// BookingScreen consumes the same `tables_json` array — no new mirror needed.
