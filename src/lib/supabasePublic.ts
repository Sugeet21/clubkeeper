import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local',
  )
}

// Anon-only client used by public Player Hub routes (/c/:slug, /poster/:slug).
// Critically: persistSession + autoRefreshToken + detectSessionInUrl are all OFF.
// This prevents the public client from sharing supabase-js's internal auth lock
// with the owner client — which was causing /c/<slug> to hang on "Loading club
// info…" when opened in a second tab from a logged-in owner browser (#83).
//
// Pattern S16 (Chunk 4.3, #110) — distinct storageKey. supabase-js v2 keys its
// navigator.locks lock off `storageKey`; without this, the public and owner
// clients share the same lock and any POSTGREST call from either side
// serialises through that lock. Under StrictMode double-mount the lock could
// be orphan-held, bricking sync forever. Distinct keys = independent locks.
export const supabasePublic = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'sb-clubkeeper-public',
  },
})
