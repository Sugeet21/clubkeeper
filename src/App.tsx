import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import BottomNav from './components/BottomNav'
import { ToastContainer } from './components/ToastContainer'
import { RequireAccess } from './components/RequireAccess'
import { useAuthStore } from './store/authStore'
import { unlockAudio } from './lib/alarm'
import { applyExpirySweep } from './lib/coinExpiry'
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
import QuickSale from './pages/QuickSale'
import Piggy from './pages/Piggy'
import PlayerScan from './pages/player/PlayerScan'
import Poster from './pages/Poster'

const PUBLIC_PATHS = ['/', '/signup', '/subscribe', '/auth/callback']
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
// Gated strictly on dbReady + session + subscriptionLoaded (Pattern D6 / A6).
function ExpirySweepRunner() {
  const { dbReady, session, subscriptionLoaded } = useAuthStore()

  useEffect(() => {
    if (isPlayerHubRoute()) return
    if (!dbReady || !session || !subscriptionLoaded) return

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
  }, [dbReady, session, subscriptionLoaded])

  return null
}

// Inner layout — needs to be inside BrowserRouter to use useLocation
function AppLayout() {
  const location = useLocation()
  const isPublicRoute =
    PUBLIC_PATHS.includes(location.pathname) ||
    location.pathname.startsWith('/c/') ||
    location.pathname.startsWith('/poster/')

  return (
    <>
      <ToastContainer />
      <div className={`min-h-screen bg-bg font-sans ${isPublicRoute ? '' : 'pb-16'}`}>
        <Routes>
          {/* ── Public routes (no auth required) ─────────────────────── */}
          <Route path="/" element={<Landing />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/subscribe" element={<Subscribe />} />
          <Route path="/c/:clubSlug" element={<PlayerScan />} />
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
            <Route path="/piggy" element={<Piggy />} />
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
        <AppLayout />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
