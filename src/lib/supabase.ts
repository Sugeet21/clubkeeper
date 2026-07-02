import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local',
  )
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// #116 runtime-proof hook — DEV builds only. Lets DevTools drive
// `await window.__supabase.auth.refreshSession()` to fire TOKEN_REFRESHED
// against SyncReader's deferForRefresh listener. Never present in prod.
if (import.meta.env.DEV) {
  ;(window as unknown as { __supabase: typeof supabase }).__supabase = supabase
}
