import { supabase } from './supabase'
import { supabasePublic } from './supabasePublic'
import { mirrorToSupabaseBySlug } from './mirrorToSupabase'
import { readAccessTokenLockFree, decodeJwtClaims } from '../db/syncClubId'
import type { ClubPublicInfo, PublicTableInfo } from '../types/playerHub'
import type { CoinTier, GameTable } from '../types'

// ─── Public (anon-accessible) calls ──────────────────────────────────────────
// These run on the public anon client (supabasePublic) so they never queue
// behind the owner client's auth refresh lock. See #83 for the bug this
// solves: /c/<slug> hung on "Loading club info…" when the owner was logged
// in in another tab on the same browser.

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function getClubPublicInfo(slug: string): Promise<ClubPublicInfo | null> {
  const { data, error } = await withTimeout(
    supabasePublic.rpc('get_club_public_info', { p_slug: slug }),
    8000,
    'get_club_public_info',
  )
  if (error) throw error
  if (!data || data.length === 0) return null
  const row = data[0]
  return {
    clubName: row.club_name as string,
    upiId: (row.upi_id as string | null) ?? null,
    acceptsTopups: row.accepts_topups as boolean,
    coinsEnabled: (row.coins_enabled as boolean | null) ?? false,
    coinTiers: (row.coin_tiers_json as CoinTier[] | null) ?? [],
    tablesJson: (row.tables_json as PublicTableInfo[] | null) ?? [],
    acceptsPricingDisplay: (row.accepts_pricing_display as boolean | null) ?? true,
    // v17 — pre-migration safe: if the RPC was last deployed before booking
    // columns existed, the row keys come back undefined. Default both fields
    // so /c/<slug> never crashes for an un-migrated club.
    acceptsBookings: (row.accepts_bookings as boolean | null) ?? false,
    bookingAdvanceAmount: (row.booking_advance_amount as number | null) ?? 100,
    // v19 (#106) — pre-migration safe: rows from a Supabase project that
    // hasn't run 20260622 yet return undefined for these. BookingScreen reads
    // null-or-undefined open/close as "not configured" and surfaces a
    // configuration-pending state to the player. NO hardcoded fallback.
    bookingOpenMinutes: (row.booking_open_minutes as number | null) ?? null,
    bookingCloseMinutes: (row.booking_close_minutes as number | null) ?? null,
    bookingAdvancePerSlot: (row.booking_advance_per_slot as number | null) ?? 50,
  }
}

export async function submitTopupIntent(
  slug: string,
  playerName: string,
  playerMobile: string,
  amount: number,
): Promise<string> {
  const { data, error } = await withTimeout(
    supabasePublic.rpc('submit_topup_intent', {
      p_slug: slug,
      p_player_name: playerName || '',
      p_player_mobile: playerMobile,
      p_amount: amount,
    }),
    8000,
    'submit_topup_intent',
  )
  if (error) {
    // Map Postgres exceptions to typed errors
    const msg = error.message ?? ''
    if (msg.includes('club_not_found')) throw new Error('club_not_found')
    if (msg.includes('topups_disabled')) throw new Error('topups_disabled')
    if (msg.includes('rate_limited')) throw new Error('rate_limited')
    throw error
  }
  return data as string
}

export async function getTopupIntentStatus(
  intentId: string,
): Promise<{ status: string; rejectReason: string | null; coinsCredited: number | null } | null> {
  const { data, error } = await withTimeout(
    supabasePublic.rpc('get_topup_intent_status', {
      p_intent_id: intentId,
    }),
    8000,
    'get_topup_intent_status',
  )
  if (error) throw error
  if (!data || data.length === 0) return null
  return {
    status: data[0].status as string,
    rejectReason: (data[0].reject_reason as string | null) ?? null,
    coinsCredited: (data[0].coins_credited as number | null) ?? null,
  }
}

// ─── Owner-authenticated calls ────────────────────────────────────────────────

export interface ClubRow {
  id: string
  slug: string
  clubName: string
  upiId: string | null
  acceptsTopups: boolean
  coinsEnabled: boolean
  coinTiers: CoinTier[]
  // v17 — advance booking
  acceptsBookings: boolean
  bookingAdvanceAmount: number
  // #145 — per-club hours + per-30-min-slot advance (#84/#106). Without these
  // in the owner DTO there is no fresh-device hydration path for them.
  bookingOpenMinutes: number | null
  bookingCloseMinutes: number | null
  bookingAdvancePerSlot: number
}

export async function getOwnerClub(): Promise<ClubRow | null> {
  const { data, error } = await supabase
    .from('clubs')
    .select('id, slug, club_name, upi_id, accepts_topups, coins_enabled, coin_tiers_json, accepts_bookings, booking_advance_amount, booking_open_minutes, booking_close_minutes, booking_advance_per_slot')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id as string,
    slug: data.slug as string,
    clubName: data.club_name as string,
    upiId: (data.upi_id as string | null) ?? null,
    acceptsTopups: data.accepts_topups as boolean,
    coinsEnabled: (data.coins_enabled as boolean | null) ?? false,
    coinTiers: (data.coin_tiers_json as CoinTier[] | null) ?? [],
    acceptsBookings: (data.accepts_bookings as boolean | null) ?? false,
    bookingAdvanceAmount: (data.booking_advance_amount as number | null) ?? 100,
    bookingOpenMinutes: (data.booking_open_minutes as number | null) ?? null,
    bookingCloseMinutes: (data.booking_close_minutes as number | null) ?? null,
    bookingAdvancePerSlot: (data.booking_advance_per_slot as number | null) ?? 50,
  }
}

export async function upsertClub(payload: {
  slug: string
  clubName: string
  upiId?: string | null
  acceptsTopups?: boolean
}): Promise<void> {
  // #103 — getUser() both contends for the GoTrue navigator lock (Pattern
  // A11, same family as #120/#139) AND round-trips the auth server, so a
  // zombie tab stranding the lock froze the slug Save button indefinitely.
  // All this call ever needed is the user id for owner_id on INSERT — decode
  // it lock-free from the JWT instead. The clubs queries below are RLS-scoped
  // by the same token, so authorization is unchanged.
  const token = readAccessTokenLockFree()
  const sub = token ? decodeJwtClaims(token).sub : undefined
  const userId = typeof sub === 'string' && sub.length > 0 ? sub : undefined
  if (!userId) throw new Error('Session expired, please sign in again')

  const { data: existing } = await supabase
    .from('clubs')
    .select('id')
    .maybeSingle()

  // Pattern X — shared payload for upsert. Insert and update branches MUST
  // write the same set of caller-owned columns. Historically the update
  // branch silently omitted `slug` (#104), turning slug into a write-once
  // column and breaking every downstream mirrorToSupabaseBySlug call.
  const clubFields = {
    slug: payload.slug,
    club_name: payload.clubName,
    upi_id: payload.upiId ?? null,
    accepts_topups: payload.acceptsTopups ?? true,
  }

  if (existing) {
    const { error } = await supabase
      .from('clubs')
      .update({ ...clubFields, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('clubs')
      .insert({ ...clubFields, owner_id: userId })
    if (error) throw error

    // #159 — creating the clubs row fires the server-side
    // `on_club_created_provision_owner_meta` trigger, which inserts the
    // owner's users_meta row. But the JWT the client is currently holding was
    // minted BEFORE that row existed, so it carries NO user_club_id claim —
    // SyncReader would keep deferring and SyncRunner would keep dead-lettering
    // until the ~1h auto-refresh. Force a refresh NOW so the fresh token picks
    // up the claim (add_user_meta_to_jwt reads the just-created users_meta row)
    // and sync activates on THIS device immediately. authStore.onAuthStateChange
    // handles the resulting TOKEN_REFRESHED; SyncReader's deferForRefresh path
    // also retries initialPull on that same event. Best-effort: a failed
    // refresh is non-fatal (the club row IS created) — the next background
    // refresh still lands the claim — so we swallow the error to keep the
    // slug-Save success path green (Pattern A11 lock-free discipline: this is
    // the ONE getSession-family call we accept here, and only on first create).
    try {
      await supabase.auth.refreshSession()
    } catch (refreshErr) {
      console.warn('[upsertClub] post-create session refresh failed; claim will land on next auto-refresh', refreshErr)
    }
  }
}

// Pattern S6: slug-routed via mirrorToSupabaseBySlug. The legacy
// `.not('id', 'is', null)` path relied on RLS narrowing to a single row, which
// breaks silently if RLS evaluates to zero rows during an auth refresh window.
export async function updateClubNameRemote(slug: string, clubName: string): Promise<void> {
  const result = await mirrorToSupabaseBySlug('updateClubNameRemote', slug, { club_name: clubName })
  if (!result.ok) throw new Error(result.reason)
}

export async function updateAcceptsTopups(slug: string, accepts: boolean): Promise<void> {
  const result = await mirrorToSupabaseBySlug('updateAcceptsTopups', slug, { accepts_topups: accepts })
  if (!result.ok) throw new Error(result.reason)
}

// Strict PH2 (#146): players pay this VPA on /c/:slug — a stale Supabase value
// sends real money to the wrong account. THROWS on mirror failure so the
// caller's Dexie write aborts and the SaveIndicator goes red. Never demote to
// warn-only. `null` clears the VPA (player payment UI degrades gracefully).
export async function updateUpiIdRemote(slug: string, upiId: string | null): Promise<void> {
  const result = await mirrorToSupabaseBySlug('updateUpiIdRemote', slug, { upi_id: upiId })
  if (!result.ok) throw new Error(`Sync failed (${result.reason})`)
}

export interface PendingTopupRow {
  id: string
  playerName: string | null
  playerMobile: string
  amount: number
  createdAt: string
}

export async function getPendingTopups(clubId: string): Promise<PendingTopupRow[]> {
  const { data, error } = await supabase
    .from('topup_intents')
    .select('id, player_name, player_mobile, amount, created_at')
    .eq('club_id', clubId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    playerName: (r.player_name as string | null) ?? null,
    playerMobile: r.player_mobile as string,
    amount: r.amount as number,
    createdAt: r.created_at as string,
  }))
}

export async function confirmTopupIntent(intentId: string): Promise<void> {
  const { error } = await supabase
    .from('topup_intents')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', intentId)
  if (error) throw error
}

export async function rejectTopupIntent(intentId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('topup_intents')
    .update({
      status: 'rejected',
      reject_reason: reason || null,
    })
    .eq('id', intentId)
  if (error) throw error
}

// Fire-and-forget: sync coin config to Supabase clubs table.
// Called after owner edits coin settings in PlayerHubSettings.
// Errors are swallowed — local Dexie is always authoritative.
export async function syncCoinConfig(
  slug: string,
  coinsEnabled: boolean,
  coinTiers: CoinTier[],
): Promise<void> {
  await mirrorToSupabaseBySlug('syncCoinConfig', slug, {
    coins_enabled: coinsEnabled,
    coin_tiers_json: coinTiers,
  })
}

// Fire-and-forget: mirror the owner's active tables to the Supabase clubs row
// as a public-safe slim projection. Called after a successful Dexie write in
// the table-save handler. Errors are swallowed — Dexie is authoritative; the
// player-side pricing card is allowed to be momentarily stale.
//
// PUBLIC-SAFE projection only. NEVER include internal IDs, session counts,
// owner-private flags, or anything else the player shouldn't see.
//
// Targets by slug to match the working `syncCoinConfig` pattern exactly — no
// extra round-trip through getOwnerClub(), no .maybeSingle() that can silently
// return null on a transient auth state. RLS still narrows to the owner's row.
export async function syncTablesJsonBySlug(
  slug: string,
  tables: GameTable[],
): Promise<void> {
  const publicTables: PublicTableInfo[] = tables
    .filter((t) => !t.outOfService)
    .map((t) => {
      const row: PublicTableInfo = {
        // v17: include the Dexie GameTable.id so player BookingScreen can round-trip
        // a table identifier back to the owner via submit_booking_intent. This is
        // a meaningless integer outside the owner's IndexedDB (no PII) — safe to
        // expose, and required for the hybrid booking model.
        id: t.id,
        name: t.name,
        gameType: t.gameType,
        ratePerHour: t.ratePerHour,
      }
      if (t.ratePerFrame !== undefined) row.ratePerFrame = t.ratePerFrame
      if (Array.isArray(t.rateCard) && t.rateCard.length > 0) row.rateCard = t.rateCard
      if (t.toleranceMinutes !== undefined) row.toleranceMinutes = t.toleranceMinutes
      if (t.rateCardBilling !== undefined) row.rateCardBilling = t.rateCardBilling
      return row
    })

  await mirrorToSupabaseBySlug('syncTablesJsonBySlug', slug, {
    tables_json: publicTables,
  })
}

// ─── v17: Advance booking (Phase 1 of #84) ───────────────────────────────────
// Mirrors the topup pattern exactly. Public-facing RPCs go through
// supabasePublic (Pattern A7 / two-client rule); owner-side mutations go through
// the authenticated `supabase` client and rely on RLS for authorization
// (per D-2026-06-11 — no Vercel function needed).

// Public: anon submits a booking intent. Returns the new intent id (UUID).
// `slotStartIso` MUST be an ISO timestamptz string in the future.
export async function submitBookingIntent(payload: {
  slug: string
  tableId: string                      // v20+ (#127): GameTable.id UUID string
  tableName: string
  gameType: string
  playerName: string
  playerPhone: string                  // 10 digits, no +91
  slotStartIso: string                 // ISO timestamptz
  durationMin: number                  // integer 15..720
  tierPrice: number                    // integer ₹
  advanceAmount: number                // integer ₹
  notes?: string
}): Promise<string> {
  const { data, error } = await withTimeout(
    supabasePublic.rpc('submit_booking_intent', {
      p_slug: payload.slug,
      p_table_id: payload.tableId,
      p_table_name: payload.tableName,
      p_game_type: payload.gameType,
      p_player_name: payload.playerName || '',
      p_player_phone: payload.playerPhone,
      p_slot_start: payload.slotStartIso,
      p_duration_min: payload.durationMin,
      p_tier_price: payload.tierPrice,
      p_advance_amount: payload.advanceAmount,
      p_notes: payload.notes ?? '',
    }),
    8000,
    'submit_booking_intent',
  )
  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('club_not_found')) throw new Error('club_not_found')
    if (msg.includes('bookings_disabled')) throw new Error('bookings_disabled')
    if (msg.includes('hours_not_set')) throw new Error('hours_not_set')
    if (msg.includes('outside_hours')) throw new Error('outside_hours')
    if (msg.includes('advance_mismatch')) throw new Error('advance_mismatch')
    if (msg.includes('slot_in_past')) throw new Error('slot_in_past')
    if (msg.includes('slot_taken')) throw new Error('slot_taken')
    if (msg.includes('rate_limited')) throw new Error('rate_limited')
    throw error
  }
  return data as string
}

// Public: player cancels their OWN confirmed booking. Phone match is the
// authorization check (player has no Supabase auth). Server-side enforces the
// >2h-before-slot window — if it returns 'too_late' we surface it inline.
export async function cancelBookingIntent(params: {
  intentId: string
  playerPhone: string
}): Promise<void> {
  const { error } = await withTimeout(
    supabasePublic.rpc('cancel_booking_intent', {
      p_intent_id: params.intentId,
      p_player_phone: params.playerPhone,
    }),
    8000,
    'cancel_booking_intent',
  )
  if (error) {
    // supabase-js wraps `raise exception '<code>'` differently across versions
    // and the chosen status code; the keyword may land in any of message,
    // details, or hint. Check all three so the typed error mapping is robust
    // to that variance.
    const errObj = error as { message?: string; details?: string; hint?: string }
    const bag = `${errObj.message ?? ''} | ${errObj.details ?? ''} | ${errObj.hint ?? ''}`
    if (bag.includes('not_found')) throw new Error('not_found')
    if (bag.includes('invalid_status')) throw new Error('invalid_status')
    if (bag.includes('too_late')) throw new Error('too_late')
    throw error
  }
}

// #90: Anon-readable list of already-taken slot windows for a (club, table,
// day) so the player time picker can grey them out instead of letting the
// player tap → pay → server reject with slot_taken. Returns ISO timestamps;
// caller converts to Unix ms. Pre-migration safe: returns [] if the RPC
// doesn't exist yet (caller catches and treats as no-blockers).
export async function getBookedSlots(params: {
  slug: string
  tableId: string                      // v20+ (#127): GameTable.id UUID string
  dayStartIso: string
  dayEndIso: string
}): Promise<{ slotStartIso: string; slotEndIso: string; status: 'pending' | 'confirmed' }[]> {
  const { data, error } = await withTimeout(
    supabasePublic.rpc('get_booked_slots', {
      p_slug: params.slug,
      p_table_id: params.tableId,
      p_day_start: params.dayStartIso,
      p_day_end: params.dayEndIso,
    }),
    8000,
    'get_booked_slots',
  )
  if (error) {
    // RPC not deployed yet → no-op (player sees the old behaviour).
    const msg = (error.message ?? '').toLowerCase()
    if (msg.includes('does not exist') || msg.includes('could not find')) return []
    throw error
  }
  if (!Array.isArray(data)) return []
  return data.map((row: { slot_start: string; slot_end: string; status?: string }) => ({
    slotStartIso: row.slot_start,
    slotEndIso: row.slot_end,
    // #147: pre-migration deployments return no status column — default to
    // 'confirmed' (slot still blocks, just no pending messaging). Safe.
    status: row.status === 'pending' ? ('pending' as const) : ('confirmed' as const),
  }))
}

export async function getBookingIntentStatus(
  intentId: string,
): Promise<{ status: string; confirmedAt: string | null } | null> {
  const { data, error } = await withTimeout(
    supabasePublic.rpc('get_booking_intent_status', { p_intent_id: intentId }),
    8000,
    'get_booking_intent_status',
  )
  if (error) throw error
  if (!data || data.length === 0) return null
  return {
    status: data[0].status as string,
    confirmedAt: (data[0].confirmed_at as string | null) ?? null,
  }
}

// Owner-authenticated: read all pending booking intents for this club.
export interface PendingBookingRow {
  id: string
  tableId: string                      // v20+ (#127): GameTable.id UUID string
  tableName: string
  gameType: string
  playerName: string | null
  playerPhone: string
  slotStart: string                    // ISO from Supabase
  slotEnd: string
  durationMin: number
  tierPrice: number
  advanceAmount: number
  notes: string | null
  createdAt: string
}

export async function getPendingBookings(clubId: string): Promise<PendingBookingRow[]> {
  const { data, error } = await supabase
    .from('booking_intents')
    .select(
      'id, table_id, table_name, game_type, player_name, player_phone, slot_start, slot_end, duration_min, tier_price, advance_amount, notes, created_at',
    )
    .eq('club_id', clubId)
    .eq('status', 'pending')
    .order('slot_start', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    tableId: r.table_id as string,
    tableName: r.table_name as string,
    gameType: r.game_type as string,
    playerName: (r.player_name as string | null) ?? null,
    playerPhone: r.player_phone as string,
    slotStart: r.slot_start as string,
    slotEnd: r.slot_end as string,
    durationMin: r.duration_min as number,
    tierPrice: r.tier_price as number,
    advanceAmount: r.advance_amount as number,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
  }))
}

// Owner-authenticated: confirm via the #147 guarded RPC, which re-validates
// at confirm time — intent must still be a live pending (10-min hold,
// D-Booking-2) and its slot must not have been rebooked. Typed failures
// surface as Error('intent_expired') / Error('slot_taken') / Error('not_found')
// for the modal row to branch on. Returns the SERVER confirmed_at so the
// Dexie booking row carries the same timestamp (no clock-skew drift).
// Pre-migration safe: if the RPC isn't deployed yet, falls back to the
// legacy unguarded UPDATE so confirms keep working until the owner runs
// 20260718_booking_pending_expiry.sql.
export async function confirmBookingIntent(intentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('confirm_booking_intent', {
    p_intent_id: intentId,
  })
  if (!error) {
    if (typeof data !== 'string') throw new Error('confirm_failed')
    return data
  }
  const msg = (error.message ?? '').toLowerCase()
  if (msg.includes('intent_expired')) throw new Error('intent_expired')
  if (msg.includes('slot_taken')) throw new Error('slot_taken')
  if (msg.includes('not_found')) throw new Error('not_found')
  if (msg.includes('does not exist') || msg.includes('could not find')) {
    // Legacy fallback (pre-#147-migration): original unguarded confirm.
    const confirmedAt = new Date().toISOString()
    const { error: updErr } = await supabase
      .from('booking_intents')
      .update({ status: 'confirmed', confirmed_at: confirmedAt })
      .eq('id', intentId)
    if (updErr) throw updErr
    return confirmedAt
  }
  throw error
}

export async function rejectBookingIntent(intentId: string): Promise<void> {
  const { error } = await supabase
    .from('booking_intents')
    .update({ status: 'rejected' })
    .eq('id', intentId)
  if (error) throw error
}

// Mirror booking config to the Supabase clubs row. Targets by slug —
// Pattern P2 — never via getOwnerClub.
//
// THROWS on mirror failure (PH2 write-order, #97): callers await this BEFORE
// their Dexie write, so a failed mirror aborts the local write and the
// SaveIndicator surfaces the error (Pattern U10). Never demote this back to
// warn-only — a swallowed failure here means the player-side /c/:slug page
// silently disagrees with the owner's toggle.
//
// All fields optional — only those defined in the call are forwarded. The
// helper auto-injects updated_at and verifies with .select('id') (Pattern S11).
// `bookingAdvanceAmount` is accepted for legacy callers but DEPRECATED — new UI
// writes only the per-slot field; the legacy column stays on the row untouched.
export interface BookingConfigPatch {
  acceptsBookings?: boolean
  bookingOpenMinutes?: number | null
  bookingCloseMinutes?: number | null
  bookingAdvancePerSlot?: number
  /** @deprecated 22 Jun 2026 — replaced by bookingAdvancePerSlot (#106). */
  bookingAdvanceAmount?: number
}

export async function syncBookingConfigBySlug(
  slug: string,
  patch: BookingConfigPatch,
): Promise<void> {
  const cols: Record<string, unknown> = {}
  if (patch.acceptsBookings !== undefined) cols.accepts_bookings = patch.acceptsBookings
  if (patch.bookingOpenMinutes !== undefined) cols.booking_open_minutes = patch.bookingOpenMinutes
  if (patch.bookingCloseMinutes !== undefined) cols.booking_close_minutes = patch.bookingCloseMinutes
  if (patch.bookingAdvancePerSlot !== undefined) cols.booking_advance_per_slot = patch.bookingAdvancePerSlot
  if (patch.bookingAdvanceAmount !== undefined) cols.booking_advance_amount = patch.bookingAdvanceAmount
  if (Object.keys(cols).length === 0) return
  const result = await mirrorToSupabaseBySlug('syncBookingConfigBySlug', slug, cols)
  if (!result.ok) throw new Error(`Sync failed (${result.reason})`)
}
