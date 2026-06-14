import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// seedIfEmpty() is now called inside authStore.initialize() after the user
// is authenticated, so the correct per-user IndexedDB is targeted.

// DEV-only: expose import helper on window so Phase A can be verified from console.
// Removed automatically from production builds via import.meta.env.DEV gate.
if (import.meta.env.DEV) {
  void import('./lib/importEverything').then((mod) => {
    ;(window as unknown as { __importEverythingFromFile?: typeof mod.importEverythingFromFile }).__importEverythingFromFile =
      mod.importEverythingFromFile
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
