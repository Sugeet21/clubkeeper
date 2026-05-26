import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// seedIfEmpty() is now called inside authStore.initialize() after the user
// is authenticated, so the correct per-user IndexedDB is targeted.

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
