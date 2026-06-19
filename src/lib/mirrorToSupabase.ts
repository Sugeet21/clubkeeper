import { supabase } from './supabase'

/**
 * Pattern S6 — All Dexie↔Supabase mirror writes go through this helper.
 *
 * Why: Hand-rolled `.update().eq('id', club.id)` calls keep falling into:
 *   - Pattern P2 (silent fail when id-routing through getOwnerClub returns stale)
 *   - Pattern S4 (write-order desync)
 *   - Zero-row updates that look successful but actually matched nothing
 *
 * This helper enforces:
 *   - slug-based routing (never id-based)
 *   - post-write `.select('id')` verification
 *   - structured warning log on zero-row matches
 *   - typed result so callers can branch on success/failure without try/catch
 *
 * Fire-and-forget callers can ignore the return; quality callers should
 * surface `result.ok === false` to the user.
 */

export type MirrorResult =
  | { ok: true }
  | { ok: false; reason: 'slug_missing' | 'supabase_error' | 'no_rows_matched'; detail?: string }

/**
 * Update one or more columns on the clubs row identified by `slug`.
 * Always include `updated_at` automatically.
 *
 * @param label  Used in warning logs to identify the caller.
 * @param slug   The owner's club slug. Empty/undefined returns `slug_missing`.
 * @param columns  Partial<ClubsRow> — Supabase column names (snake_case).
 */
export async function mirrorToSupabaseBySlug(
  label: string,
  slug: string | undefined | null,
  columns: Record<string, unknown>,
): Promise<MirrorResult> {
  if (!slug) {
    console.warn(`[${label}] slug is missing — skipping Supabase mirror`)
    return { ok: false, reason: 'slug_missing' }
  }

  const { data, error } = await supabase
    .from('clubs')
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq('slug', slug)
    .select('id')

  if (error) {
    console.warn(`[${label}] Supabase mirror failed:`, error.message)
    return { ok: false, reason: 'supabase_error', detail: error.message }
  }
  if (!data || data.length === 0) {
    console.warn(
      `[${label}] mirror matched 0 rows for slug="${slug}" — check that the owner's club row has this slug.`,
    )
    return { ok: false, reason: 'no_rows_matched' }
  }
  return { ok: true }
}
