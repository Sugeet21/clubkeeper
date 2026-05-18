import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'
import Summary from './pages/Summary'
import History from './pages/History'
import Settings from './pages/Settings'
import StartSession from './pages/StartSession'
import SessionDetail from './pages/SessionDetail'

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="min-h-screen bg-bg font-sans pb-16">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/start/:tableId" element={<StartSession />} />
            <Route path="/session/:sessionId" element={<SessionDetail />} />
          </Routes>
        </div>
        <BottomNav />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
