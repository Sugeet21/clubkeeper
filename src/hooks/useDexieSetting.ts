import { useCallback } from 'react'
import { useSettings } from './useLiveData'
import { updateSettings } from '../db/queries'
import { db } from '../db/database'
import type { ClubSettings } from '../types'

/**
 * Read/write a single ClubSettings field with Dexie as the single source of truth.
 *
 * Use this for ANY settings toggle / select / input value that is stored in the
 * `settings` Dexie store. Do NOT mirror a settings field into local `useState`
 * and re-sync it from Dexie via `useEffect` — that's Pattern R4 (settings
 * drift). The local mirror captures a stale snapshot whenever the component
 * re-mounts before `useLiveQuery` has resolved, and silently drifts away from
 * Dexie's authoritative value (see issue #97).
 *
 * Reads come through `useSettings()` (`useLiveQuery(db.settings.get(1))`) so
 * the value stays reactive across the whole tree.
 *
 * Writes go through `updateSettings({ [key]: next })`, which is `db.settings
 * .update(1, …)`. The settings row is seeded at device init, so the id=1
 * update path is always live by the time a UI component renders.
 *
 * Supabase mirroring is the CALLER's responsibility. Different fields mirror
 * through different RPCs (`updateAcceptsTopups`, `syncBookingConfigBySlug`,
 * `syncCoinConfig`, `mirrorSettingsToSupabase`, …) and several deliberately
 * mirror to Supabase BEFORE Dexie so a failed remote write never produces a
 * desynced local toggle. Wrap `setValue` with the appropriate mirror in the
 * call site rather than baking one mirror into the hook.
 *
 * Typing-buffer variant — for inputs the user is mid-edit (e.g. a numeric
 * field that the user clears to retype), keep a separate `useState` draft and
 * write to Dexie on blur:
 *
 *   const [amount, setAmount] = useDexieSetting('bookingAdvanceAmount', 0)
 *   const [draft, setDraft] = useState(String(amount))
 *   useEffect(() => { setDraft(String(amount)) }, [amount])
 *   // onBlur: parse + validate, then setAmount(parsed) — or revert draft.
 */
export function useDexieSetting<K extends keyof ClubSettings>(
  key: K,
  fallback: NonNullable<ClubSettings[K]>,
): [NonNullable<ClubSettings[K]>, (next: NonNullable<ClubSettings[K]>) => Promise<void>] {
  const settings = useSettings()
  const raw = settings?.[key]
  const value = (raw ?? fallback) as NonNullable<ClubSettings[K]>

  const setValue = useCallback(
    async (next: NonNullable<ClubSettings[K]>) => {
      // eslint-disable-next-line no-console
      console.log('[useDexieSetting] write', key, '→', next) // TEMP #97 diag — remove after triage
      await updateSettings({ [key]: next } as Partial<ClubSettings>)
      const after = await db.settings.toCollection().first()
      // eslint-disable-next-line no-console
      console.log('[useDexieSetting] readback', key, '=', after?.[key]) // TEMP #97 diag — remove after triage
    },
    [key],
  )

  return [value, setValue]
}
