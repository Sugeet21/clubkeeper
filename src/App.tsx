import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import BottomNav from './components/BottomNav'
import { ToastContainer } from './components/ToastContainer'
import { RequireAccess } from './components/RequireAccess'
import { useAuthStore } from './store/authStore'
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

const PUBLIC_PATHS = ['/', '/signup', '/subscribe', '/auth/callback']

// Initializes Supabase auth once on mount
function AuthInitializer() {
  useEffect(() => {
    useAuthStore.getState().initialize()
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
        <AppLayout />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
