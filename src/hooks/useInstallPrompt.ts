import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'ck-install-dismissed'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    // Don't show if already installed as standalone PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return

    // Don't show if dismissed within 7 days
    const stored = localStorage.getItem(DISMISS_KEY)
    if (stored && Date.now() - parseInt(stored, 10) < SEVEN_DAYS_MS) return

    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
      setShowBanner(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') {
      setShowBanner(false)
      setPrompt(null)
    }
  }

  function dismiss() {
    setShowBanner(false)
    localStorage.setItem(DISMISS_KEY, Date.now().toString())
  }

  return { showBanner, install, dismiss }
}
