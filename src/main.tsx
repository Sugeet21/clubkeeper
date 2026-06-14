import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// seedIfEmpty() is now called inside authStore.initialize() after the user
// is authenticated, so the correct per-user IndexedDB is targeted.

// DEV-only: expose import helper + round-trip self-test on window so Phase A
// and Phase C can be verified from the console. Removed automatically from
// production builds via the import.meta.env.DEV gate (Vite tree-shakes it out).
if (import.meta.env.DEV) {
  void import('./lib/importEverything').then((mod) => {
    ;(window as unknown as { __importEverythingFromFile?: typeof mod.importEverythingFromFile }).__importEverythingFromFile =
      mod.importEverythingFromFile
  })
  void import('./lib/__devTools__/importExportRoundTrip').then((mod) => {
    ;(window as unknown as { runImportExportRoundTrip?: typeof mod.runImportExportRoundTrip }).runImportExportRoundTrip =
      mod.runImportExportRoundTrip
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
