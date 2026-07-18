import { supabase } from './supabase'

// #154 — server-side half of Settings "Type RESET". Calls the owner-gated
// reset_club_data() RPC (SECURITY DEFINER; there are no DELETE policies, so
// this is the ONLY way club data leaves Supabase). Pattern PH2 write order:
// callers run this FIRST and only clear Dexie after it resolves — a failed
// server wipe must abort the local one, or sync resurrects everything.

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

interface ResetRpcResponse {
  data: { ok?: boolean; deleted?: Record<string, number> } | null
  error: { message: string } | null
}

export async function resetClubDataRemote(): Promise<Record<string, number>> {
  // Builder cast: supabase-js rpc() returns a thenable builder, not a Promise
  // (same shape problem as the Razorpay SDK casts in api/*.ts)
  const { data, error } = await withTimeout(
    supabase.rpc('reset_club_data') as unknown as Promise<ResetRpcResponse>,
    15000,
    'reset_club_data',
  )
  if (error) throw new Error(`Server reset failed (${error.message})`)
  if (!data?.ok) throw new Error('Server reset failed (unexpected response)')
  return data.deleted ?? {}
}
