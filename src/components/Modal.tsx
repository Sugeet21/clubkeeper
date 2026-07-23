import { useEffect, type ReactNode } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  // Prevent body scroll while open (#177 — reference-counted so overlapping
  // modals never leak a permanent 'hidden' onto the body).
  useBodyScrollLock(open)

  // Close on Escape key; listener added/removed with open state
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Scrim — separate fixed layer, below the sheet (z-40) */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet — mobile: bottom sheet (bottom-0 full width, rounded-t).
          Desktop (md:): centered dialog, capped at 560px, rounded on all sides.
          flex-col so header/footer pin and middle scrolls. */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-elevated rounded-t-3xl border-t border-border flex flex-col max-h-[92vh] md:bottom-auto md:left-1/2 md:top-1/2 md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(560px,calc(100vw-2rem))] md:rounded-3xl md:border md:max-h-[85vh]">
        {/* Pinned header — shrink-0 */}
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="w-10 h-1 bg-border-bright rounded-full mx-auto mb-4" />
          <h4 className="text-[18px] font-bold tracking-tight text-text">{title}</h4>
        </div>
        {/* Scrollable content */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5 pb-3"
          style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          {children}
        </div>
        {/* Pinned footer — only rendered when passed */}
        {footer && (
          <div
            className="shrink-0 px-5 pt-3 pb-5 border-t border-border"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
        {/* Default bottom padding when no footer */}
        {!footer && <div className="shrink-0 h-6" />}
      </div>
    </>
  )
}
