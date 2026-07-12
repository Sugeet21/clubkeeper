// Phase D (D8) — Settings → Staff management (owner-only).
//
// Rule H pre-flight (cited in the D8 commit): this section touches NO
// ClubSettings field — it reads/writes users_meta + auth via the two D2
// serverless endpoints. So Patterns T2/R4/F5/S11 do NOT apply (no settings
// mirror, no clubs-row write, no Toggle). Component state here (staff list,
// in-flight flags, show-once password) is genuine local UI state, not a
// Pattern-R4 settings mirror. Deliberately NO SaveIndicator (Pattern U10):
// these are server ops with explicit success screens (show-once credentials /
// confirm dialogs), not settings saves — a SaveIndicator would fight the
// show-once UX. A12: the whole section (trigger + modals) mounts only for the
// owner (wrapped in <OwnerOnly> at the call site + the D4 role split already
// keeps staff out of the owner Settings body).
//
// Username gap (known): the owner-read policy on users_meta exposes name /
// active / created_at but NOT the generated <slug>.ck.local username — that
// lives in auth.users, unreachable via RLS. So the list is name-only; the
// username is shown ONLY on the show-once screen at create/reset (matching how
// api/create-staff returns it once). A permanent-username list would need a
// new list-staff endpoint (deferred D8b).

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { readAccessTokenLockFree } from '../../db/syncClubId'
import { Modal } from '../Modal'
import { useToastStore } from '../../store/toastStore'

// ─── Types ──────────────────────────────────────────────────────────────────

interface StaffRow {
  userId: string
  name: string
  active: boolean
  createdAt: string
}

interface Credentials {
  name: string
  username: string
  password: string
}

type ListState = 'loading' | 'loaded' | 'error'

// ─── Icons ──────────────────────────────────────────────────────────────────

function IconStaff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

// ─── Fetch helper (Pattern S1) ──────────────────────────────────────────────

async function callStaffApi<T>(path: string, body: unknown): Promise<T> {
  // #139 — read the bearer token LOCK-FREE. `supabase.auth.getSession()` queues
  // on the GoTrue navigator lock (Pattern A7/A11/S16); a zombie tab stranding
  // that lock made create/reset/revoke HANG until a hard refresh. This reader
  // hits the in-memory authStore session first (no lock, no localStorage) and
  // falls back to a synchronous localStorage read — never hangs.
  const accessToken = readAccessTokenLockFree()
  if (!accessToken) throw new Error('Not signed in. Please sign in again.')

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (res.status === 404) {
      throw new Error('Staff service unavailable. Locally, run `vercel dev` (npm run dev can\'t serve /api/).')
    }
    if (!res.ok) {
      let msg = 'Something went wrong. Try again.'
      try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch { /* empty body */ }
      throw new Error(msg)
    }
    try {
      return (await res.json()) as T
    } catch {
      throw new Error('Bad response from server.')
    }
  } catch (e) {
    clearTimeout(t)
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Request timed out. Check your connection.')
    }
    throw e
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function StaffSection() {
  const [rows, setRows] = useState<StaffRow[]>([])
  const [listState, setListState] = useState<ListState>('loading')

  // Create-staff modal
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Show-once credentials screen (create OR reset)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset-password in flight (per row)
  const [resetBusyId, setResetBusyId] = useState<string | null>(null)

  // Remove-confirm modal
  const [removeTarget, setRemoveTarget] = useState<StaffRow | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  // The owner-read RLS policy on users_meta (D1) scopes this to the caller's
  // own club — no explicit club filter needed. Main authenticated client only.
  const loadStaff = useCallback(async () => {
    setListState('loading')

    // Timeout guard (Pattern S1 discipline): if the main supabase client is
    // ever lock-stranded (a zombie tab holding the GoTrue navigator lock —
    // #120 / Pattern A7-S16), a bare await would skeleton forever. Race a
    // 12s timeout so it falls into the recoverable error-state (Retry button)
    // instead of an infinite spinner.
    type MetaRow = { user_id: string; name: string; active: boolean; created_at: string }
    const query = supabase
      .from('users_meta')
      .select('user_id, name, active, created_at')
      .eq('role', 'staff')
      .order('created_at', { ascending: false })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('users_meta list timed out')), 12000),
    )

    let list: MetaRow[] = []
    try {
      const { data, error } = await Promise.race([query, timeout])
      if (error) {
        console.error('load staff error:', error)
        setListState('error')
        return
      }
      list = (data ?? []) as MetaRow[]
    } catch (e) {
      console.error('load staff timeout/error:', e)
      setListState('error')
      return
    }
    setRows(list.map((r) => ({ userId: r.user_id, name: r.name, active: r.active, createdAt: r.created_at })))
    setListState('loaded')
  }, [])

  useEffect(() => {
    void loadStaff()
  }, [loadStaff])

  async function handleCreate() {
    if (createBusy) return
    const name = newName.trim()
    if (!name) { setCreateError('Enter a name.'); return }
    setCreateBusy(true)
    setCreateError(null)
    try {
      const result = await callStaffApi<{ userId: string; email: string; password: string; name: string }>(
        '/api/create-staff',
        { name },
      )
      setCreateOpen(false)
      setNewName('')
      setCopied(false)
      setCredentials({ name: result.name, username: result.email, password: result.password })
      await loadStaff()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create staff.')
    } finally {
      setCreateBusy(false)
    }
  }

  async function handleReset(row: StaffRow) {
    if (resetBusyId) return
    setResetBusyId(row.userId)
    try {
      const result = await callStaffApi<{ password: string }>(
        '/api/manage-staff',
        { action: 'reset_password', staffUserId: row.userId },
      )
      setCopied(false)
      // Username isn't in the reset response (auth.users, not returned). Show
      // the name + new password; the username is unchanged from creation.
      setCredentials({ name: row.name, username: '', password: result.password })
    } catch (e) {
      useToastStore.getState().show(e instanceof Error ? e.message : 'Failed to reset password.', 'error')
    } finally {
      setResetBusyId(null)
    }
  }

  async function handleRemove() {
    if (!removeTarget || removeBusy) return
    setRemoveBusy(true)
    try {
      await callStaffApi<{ revoked: boolean }>(
        '/api/manage-staff',
        { action: 'revoke', staffUserId: removeTarget.userId },
      )
      useToastStore.getState().show(`${removeTarget.name} removed.`, 'success')
      setRemoveTarget(null)
      await loadStaff()
    } catch (e) {
      useToastStore.getState().show(e instanceof Error ? e.message : 'Failed to remove staff.', 'error')
    } finally {
      setRemoveBusy(false)
    }
  }

  function copyCredentials() {
    if (!credentials) return
    const text = credentials.username
      ? `ClubKeeper login\nUsername: ${credentials.username}\nPassword: ${credentials.password}`
      : `ClubKeeper login\nNew password: ${credentials.password}`
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000) },
      () => useToastStore.getState().show('Copy failed — write it down manually.', 'error'),
    )
  }

  return (
    <div className="mt-3 space-y-2">
      {/* Staff list */}
      {listState === 'loading' ? (
        <div className="py-4 space-y-2">
          <div className="w-full h-12 rounded-xl bg-bg animate-pulse" />
          <div className="w-full h-12 rounded-xl bg-bg animate-pulse" />
        </div>
      ) : listState === 'error' ? (
        <div className="py-3">
          <p className="text-[13px] text-busy mb-2">Couldn't load staff.</p>
          <button
            onClick={() => void loadStaff()}
            className="min-h-[44px] px-4 rounded-xl text-[13px] font-semibold bg-bg border border-border text-text active:bg-bg-card transition-colors"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-text-faint text-[13px] py-2">
          No staff yet. Add one to let a helper run sessions without seeing your revenue or settings.
        </p>
      ) : (
        rows.map((r) => (
          <div key={r.userId} className="p-3 rounded-xl bg-bg border border-border">
            <div className="flex items-center gap-2">
              <p className="flex-1 min-w-0 truncate text-[14px] font-semibold text-text">{r.name}</p>
              {r.active ? (
                <span className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-free/15 text-free shrink-0">
                  Active
                </span>
              ) : (
                <span className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-busy/15 text-busy shrink-0">
                  Removed
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-text-faint mt-0.5">
              Added {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
            {r.active && (
              <div className="grid grid-cols-2 gap-2 mt-2.5">
                <button
                  onClick={() => void handleReset(r)}
                  disabled={resetBusyId !== null}
                  className="min-h-[44px] py-2 rounded-lg text-[12px] font-semibold bg-bg-card border border-border text-text active:bg-bg transition-colors disabled:opacity-50"
                >
                  {resetBusyId === r.userId ? 'Resetting…' : 'Reset password'}
                </button>
                <button
                  onClick={() => setRemoveTarget(r)}
                  disabled={resetBusyId !== null}
                  className="min-h-[44px] py-2 rounded-lg text-[12px] font-semibold bg-busy/8 border border-busy/20 text-busy active:bg-busy/15 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {/* Add staff CTA */}
      <button
        onClick={() => { setNewName(''); setCreateError(null); setCreateOpen(true) }}
        className="w-full min-h-[44px] mt-1 py-2.5 border border-dashed border-border rounded-xl text-[13px] font-semibold text-accent flex items-center justify-center gap-1.5"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add staff
      </button>

      {/* ── Create staff modal ─────────────────────────────────────────── */}
      <Modal
        open={createOpen}
        onClose={() => !createBusy && setCreateOpen(false)}
        title="Add staff"
      >
        <p className="text-text-dim text-[13px] mb-4">
          We'll generate a username and password for this person. You'll see them once — write them down.
        </p>
        <label className="block text-[11px] font-mono uppercase tracking-widest text-text-faint mb-1.5">
          Name
        </label>
        <input
          type="text"
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setCreateError(null) }}
          placeholder="e.g. Rajesh"
          className="w-full px-4 py-3.5 bg-bg border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint min-h-[44px]"
        />
        {createError && <p className="text-busy text-[12px] mt-2">{createError}</p>}
        <div className="grid grid-cols-2 gap-3 mt-5">
          <button
            onClick={() => setCreateOpen(false)}
            disabled={createBusy}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={createBusy || !newName.trim()}
            className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold disabled:bg-bg disabled:text-text-faint disabled:border disabled:border-border"
          >
            {createBusy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </Modal>

      {/* ── Show-once credentials screen ───────────────────────────────── */}
      {/* onClose is a deliberate no-op: the password lives ONLY in component  */}
      {/* state (show-once discipline), so a stray scrim tap / Escape would    */}
      {/* destroy the sole copy. Dismiss is via the explicit Done button only. */}
      <Modal
        open={credentials !== null}
        onClose={() => {}}
        title={credentials?.username ? 'Staff created' : 'New password'}
      >
        <div className="p-3 rounded-xl bg-paused/10 border border-paused/25 mb-4">
          <p className="text-[13px] text-paused font-semibold">
            Save this now — {credentials?.username ? 'the password is' : 'this password is'} shown only once.
          </p>
        </div>

        {credentials?.username ? (
          <div className="p-3 bg-bg rounded-xl mb-2 border border-border">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Username</p>
            <p className="text-text text-[14px] font-mono mt-0.5 break-all">{credentials.username}</p>
          </div>
        ) : (
          // Reset variant: no username to show (it lives in auth.users, not
          // returned) — surface the staff NAME so the owner knows who this
          // password is for (reviewer Concern 2).
          <div className="p-3 bg-bg rounded-xl mb-2 border border-border">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Staff</p>
            <p className="text-text text-[14px] mt-0.5 truncate">{credentials?.name}</p>
          </div>
        )}
        <div className="p-3 bg-bg rounded-xl mb-4 border border-border">
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Password</p>
          <p className="text-text text-[18px] font-mono font-bold mt-0.5 tracking-wide">{credentials?.password}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={copyCredentials}
            className="min-h-[44px] py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 active:bg-bg transition-colors"
          >
            <CopyIcon />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={() => setCredentials(null)}
            className="min-h-[44px] py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold"
          >
            Done
          </button>
        </div>
      </Modal>

      {/* ── Remove confirm modal ───────────────────────────────────────── */}
      <Modal
        open={removeTarget !== null}
        onClose={() => !removeBusy && setRemoveTarget(null)}
        title="Remove staff?"
      >
        <p className="text-text-dim text-[14px] mb-2">
          <span className="text-text font-semibold">{removeTarget?.name}</span> will lose access. Their sign-in stops
          working (within an hour at most).
        </p>
        <p className="text-text-faint text-[12px] mb-5">
          To bring them back later, create a new account — this can't be undone.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setRemoveTarget(null)}
            disabled={removeBusy}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleRemove}
            disabled={removeBusy}
            className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {removeBusy ? 'Removing…' : 'Yes, remove'}
          </button>
        </div>
      </Modal>

      {/* Section icon lives at the call site; exported for the header there. */}
    </div>
  )
}

export { IconStaff }
