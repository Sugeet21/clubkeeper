import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import BottomNav from './components/BottomNav'
import { ToastContainer } from './components/ToastContainer'
import { RequireAccess } from './components/RequireAccess'
import { useAuthStore } from './store/authStore'
import { unlockAudio } from './lib/alarm'
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

const PUBLIC_PATHS = ['/', '/signup', '/subscribe', '/auth/callback']
// Wallet routes are private but not in BottomNav — they are deep-linked pages.
// They must NOT be in PUBLIC_PATHS (would hide BottomNav on /tables if added).
// The BottomNav hides on any path in PUBLIC_PATHS — wallet paths are not in it.

// Initializes Supabase auth once on mount
function AuthInitializer() {
  useEffect(() => {
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

// Inner layout — needs to be inside BrowserRouter to use useLocation
function AppLayout() {
  const location = useLocation()
  const isPublicRoute = PUBLIC_PATHS.includes(location.pathname)

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
        <AppLayout />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
