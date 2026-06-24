import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Install crypto.randomUUID polyfill for iOS Safari < 15.4 BEFORE any code path
// that may call it (Dexie ops, coin expiry, nudges, streak, walk-in codes).
// Fixes latent bug present since those features shipped; required by v20 UUID migration.
if (!crypto.randomUUID) {
  // @ts-expect-error attach polyfill — only this @ts-expect-error is allowed in Phase B
  crypto.randomUUID = () => {
    const hex = () => Math.floor(Math.random() * 16).toString(16)
    let id = ''
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) id += '-'
      else if (i === 14) id += '4'
      else if (i === 19) id += (Math.floor(Math.random() * 4) + 8).toString(16)
      else id += hex()
    }
    return id as `${string}-${string}-${string}-${string}-${string}`
  }
}

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
