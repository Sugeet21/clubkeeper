import { supabase } from './supabase'
import { supabasePublic } from './supabasePublic'
import type { ClubPublicInfo } from '../types/playerHub'
import type { CoinTier } from '../types'

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
): Promise<{ status: string; rejectReason: string | null } | null> {
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
}

export async function getOwnerClub(): Promise<ClubRow | null> {
  const { data, error } = await supabase
    .from('clubs')
    .select('id, slug, club_name, upi_id, accepts_topups, coins_enabled, coin_tiers_json')
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
  }
}

export async function upsertClub(payload: {
  slug: string
  clubName: string
  upiId?: string | null
  acceptsTopups?: boolean
}): Promise<void> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Session expired, please sign in again')

  const { data: existing } = await supabase
    .from('clubs')
    .select('id')
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('clubs')
      .update({
        club_name: payload.clubName,
        upi_id: payload.upiId ?? null,
        accepts_topups: payload.acceptsTopups ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('clubs').insert({
      slug: payload.slug,
      club_name: payload.clubName,
      upi_id: payload.upiId ?? null,
      accepts_topups: payload.acceptsTopups ?? true,
      owner_id: user.id,
    })
    if (error) throw error
  }
}

export async function updateClubNameRemote(clubName: string): Promise<void> {
  const { error } = await supabase
    .from('clubs')
    .update({ club_name: clubName, updated_at: new Date().toISOString() })
    .not('id', 'is', null)
  if (error) throw error
}

export async function updateAcceptsTopups(accepts: boolean): Promise<void> {
  const { error } = await supabase
    .from('clubs')
    .update({ accepts_topups: accepts, updated_at: new Date().toISOString() })
    .not('id', 'is', null)
  if (error) throw error
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
  const { error } = await supabase
    .from('clubs')
    .update({
      coins_enabled: coinsEnabled,
      coin_tiers_json: coinTiers,
      updated_at: new Date().toISOString(),
    })
    .eq('slug', slug)
  if (error) console.warn('[syncCoinConfig] Supabase sync failed:', error.message)
}
