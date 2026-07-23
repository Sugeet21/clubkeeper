import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import BottomNav from './components/BottomNav'
import { ToastContainer } from './components/ToastContainer'
import { RequireAccess } from './components/RequireAccess'
import { RequireOwner } from './components/auth/RequireOwner'
import { useAuthStore } from './store/authStore'
import { unlockAudio } from './lib/alarm'
import { applyExpirySweep } from './lib/coinExpiry'
import { applyNoShowSweep } from './db/queries'
import { syncRunner } from './db/syncRunner'
import Home from './pages/Home'
import Summary from './pages/Summary'
import History from './pages/History'
import Settings from './pages/Settings'
import StartSession from './pages/StartSession'
import SessionDetail from './pages/SessionDetail'
import Landing from './pages/Landing'
import Signup from './pages/Signup'
import Subscribe from './pages/Subscribe'
import { AuthCallback } from './pages/AuthCallback'
import Wallet from './pages/Wallet'
import WalletNewCustomer from './pages/WalletNewCustomer'
import WalletTopup from './pages/WalletTopup'
import CustomerProfile from './pages/CustomerProfile'
import Canteen from './pages/Canteen'
import BulkRestock from './pages/BulkRestock'
import BulkCategoryTag from './pages/BulkCategoryTag'
import RestockHistory from './pages/RestockHistory'
import QuickSale from './pages/QuickSale'
import Piggy from './pages/Piggy'
import Bookings from './pages/Bookings'
import PlayerScan from './pages/player/PlayerScan'
import BookingScreen from './pages/player/BookingScreen'
import Poster from './pages/Poster'
import { TopupRealtimeBridge } from './components/TopupRealtimeBridge'
import { BookingRealtimeBridge } from './components/BookingRealtimeBridge'
import { SyncReaderBoot } from './components/SyncReaderBoot'
import { SyncBackfillBoot } from './components/SyncBackfillBoot'
// Phase C Chunk 3 — sync wrapper smoke-test page, DEV-only route.
import TestOutbox from './pages/__dev__/TestOutbox'
// Phase C Chunk 5.2b — SyncReader runtime-proof page, DEV-only route.
import TestSyncReader from './pages/__dev__/TestSyncReader'
import TestNumberPad from './pages/__dev__/TestNumberPad'

const PUBLIC_PATHS = ['/', '/signup', '/subscribe', '/auth/callback', '/auth/login']
// /c/ and /poster/ are public but use path prefixes — checked via startsWith in AppLayout
// Wallet routes are private but not in BottomNav — they are deep-linked pages.
// They must NOT be in PUBLIC_PATHS (would hide BottomNav on /tables if added).
// The BottomNav hides on any path in PUBLIC_PATHS — wallet paths are not in it.

// Returns true if the current URL is a public Player Hub route.
// Read from window.location directly so callers don't need to be inside Router.
function isPlayerHubRoute(): boolean {
  if (typeof window === 'undefined') return false
  const p = window.location.pathname
  return p.startsWith('/c/') || p.startsWith('/poster/')
}

// Initializes Supabase auth once on mount.
// SKIPPED entirely on /c/ and /poster/ routes — these are public Player Hub
// pages that must never touch owner auth. Without this gate, an owner who is
// logged in in another tab causes the same supabase-js client to hold an auth
// lock that public RPCs queue behind, hanging /c/<slug> on "Loading club
// info…" indefinitely. See issue #83.
function AuthInitializer() {
  useEffect(() => {
    if (isPlayerHubRoute()) return
    useAuthStore.getState().initialize()
  }, [])
  return null
}

// Unlocks Web Audio API on the first user gesture anywhere in the app.
// iOS Safari suspends AudioContext until a user gesture — this fires once
// on the first tap or keypress, then removes itself.
function AudioUnlocker() {
  useEffect(() => {
    const handler = () => {
      unlockAudio()
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('keydown', handler)
    }
    window.addEventListener('pointerdown', handler, { passive: true })
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('keydown', handler)
    }
  }, [])
  return null
}

// Runs the coin expiry sweep once per 4 hours per browser session.
// Gated strictly on dbReady + userId + subscriptionLoaded (Pattern D6 / A6 /
// A10). userId (not `session`) is the effect dep so a re-set of the same
// session object doesn't re-run this pointlessly — a broken A10 dep would
// re-fire on every INITIAL_SESSION replay; the 4h sessionStorage guard
// currently masks that cost, but uniformity across boot components is
// safer than per-file exceptions.
function ExpirySweepRunner() {
  const { dbReady, session, subscriptionLoaded } = useAuthStore()
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (isPlayerHubRoute()) return
    if (!dbReady || !userId || !subscriptionLoaded) return

    const FOUR_HOURS = 4 * 60 * 60 * 1000
    const lastSweep = Number(sessionStorage.getItem('lastExpirySweep') ?? 0)
    if (Date.now() - lastSweep < FOUR_HOURS) return

    applyExpirySweep()
      .then(({ totalExpired }) => {
        sessionStorage.setItem('lastExpirySweep', String(Date.now()))
        if (totalExpired > 0) {
          console.log(`[expiry] expired ${totalExpired} coins across customers`)
        }
      })
      .catch((err: unknown) => console.error('[expiry] sweep failed', err))

    // P1e-2: no-show sweep — mark confirmed bookings 'no_show' once their
    // slot ends + 30 min grace passes without a session link. Same 4h cadence,
    // same gates, NO wallet refund (forfeit per skill policy).
    applyNoShowSweep()
      .then((count) => {
        if (count > 0) {
          console.log(`[booking] marked ${count} no-show booking(s)`)
        }
      })
      .catch((err: unknown) => console.error('[booking] no-show sweep failed', err))
  }, [dbReady, userId, subscriptionLoaded])

  return null
}

// Phase C Chunk 4 — owns the SyncRunner lifecycle. Mirrors ExpirySweepRunner
// gating: only starts once dbReady + userId land AND we're not on a player-hub
// route (which must never touch owner Supabase). On unmount / sign-out the
// runner stops cleanly so the online listener + 30s heartbeat are torn down.
//
// Pattern A10 — depends on userId (primitive) not `session` (object). A
// zustand set({session}) creates a new reference even for the same signed-in
// account (e.g. onAuthStateChange's INITIAL_SESSION delivering the same data
// getSession() just returned). Depending on the raw ref would tear down and
// re-start the runner on every such set, and each start bumps drainGeneration
// — an in-flight drain would then bail as an orphan, wasting a Supabase
// round-trip per redundant fire. TopupRealtimeBridge + BookingRealtimeBridge
// are the reference-correct examples of this pattern.
function SyncRunnerBoot() {
  const { dbReady, session } = useAuthStore()
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (isPlayerHubRoute()) return
    if (!dbReady || !userId) return

    syncRunner.start()
    return () => {
      syncRunner.stop()
    }
  }, [dbReady, userId])

  return null
}

// Inner layout — needs to be inside BrowserRouter to use useLocation
function AppLayout() {
  const location = useLocation()
  const isPublicRoute =
    PUBLIC_PATHS.includes(location.pathname) ||
    location.pathname.startsWith('/c/') ||
    location.pathname.startsWith('/poster/')

  // `/c/<slug>/book` reuses the public Player Hub path-prefix guard above
  // (`startsWith('/c/')`) — no change needed to AuthInitializer / Bridge skips.

  return (
    <>
      <ToastContainer />
      <div className={`min-h-screen bg-bg font-sans ${isPublicRoute ? '' : 'pb-16'}`}>
        <Routes>
          {/* ── Public routes (no auth required) ─────────────────────── */}
          <Route path="/" element={<Landing />} />
          <Route path="/signup" element={<Signup />} />
          {/* Phase C Chunk 1 — owner sign-in alias. Reuses the Signup screen
              (which already handles already-signed-in → redirect) so there's
              one onboarding surface, not two. */}
          <Route path="/auth/login" element={<Signup />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/subscribe" element={<Subscribe />} />
          <Route path="/c/:clubSlug" element={<PlayerScan />} />
          <Route path="/c/:clubSlug/book" element={<BookingScreen />} />
          <Route path="/poster/:slug" element={<Poster />} />

          {/* ── Private routes (auth + active subscription required) ──── */}
          <Route element={<RequireAccess />}>
            <Route path="/tables" element={<Home />} />
            <Route path="/start/:tableId" element={<StartSession />} />
            <Route path="/session/:sessionId" element={<SessionDetail />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            {/* ── Wallet routes ── */}
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/wallet/new" element={<WalletNewCustomer />} />
            <Route path="/wallet/topup/:customerId" element={<WalletTopup />} />
            <Route path="/customer/:customerId" element={<CustomerProfile />} />
            <Route path="/canteen" element={<Canteen />} />
            <Route path="/quick-sale" element={<QuickSale />} />
            {/* Phase D (D7) — owner-only routes: staff deep-links bounce to
                /tables at the router, before the page mounts. Piggy's D6
                role split stays as defense-in-depth behind this guard. */}
            <Route element={<RequireOwner />}>
              <Route path="/piggy" element={<Piggy />} />
              {/* #173 — bulk restock is owner-only (R10). RequireOwner bounces
                  staff to /tables at the router, before the page mounts. */}
              <Route path="/canteen/bulk-restock" element={<BulkRestock />} />
              <Route path="/canteen/restock-history" element={<RestockHistory />} />
              {/* #176 — one-time bulk category tagging, owner-only like the rest of restock. */}
              <Route path="/canteen/tag-categories" element={<BulkCategoryTag />} />
            </Route>
            <Route path="/bookings" element={<Bookings />} />
            {/* Phase C Chunk 3 — DEV-only sync wrapper smoke test. Gated on
                import.meta.env.DEV so production never serves this. */}
            {import.meta.env.DEV && (
              <Route path="/__dev/test-outbox" element={<TestOutbox />} />
            )}
            {/* Phase C Chunk 5.2b — DEV-only SyncReader runtime proof. */}
            {import.meta.env.DEV && (
              <Route path="/__dev/test-sync-reader" element={<TestSyncReader />} />
            )}
            {/* #173 Chunk 1 — DEV-only NumberPad no-keyboard harness. */}
            {import.meta.env.DEV && (
              <Route path="/__dev/test-number-pad" element={<TestNumberPad />} />
            )}
          </Route>
        </Routes>
      </div>
      {!isPublicRoute && <BottomNav />}
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthInitializer />
        <AudioUnlocker />
        <ExpirySweepRunner />
        <SyncRunnerBoot />
        <SyncReaderBoot />
        <SyncBackfillBoot />
        <TopupRealtimeBridge />
        <BookingRealtimeBridge />
        <AppLayout />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
