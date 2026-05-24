import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  // Prevent body scroll while open; restore on close or unmount
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

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
      {/* Sheet — fixed to bottom, above scrim (z-50) */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-elevated rounded-t-3xl border-t border-border px-5 pt-5 pb-10">
        {/* Drag handle */}
        <div className="w-10 h-1 bg-border-bright rounded-full mx-auto mb-5" />
        <h4 className="text-[18px] font-bold tracking-tight text-text mb-3">{title}</h4>
        {children}
      </div>
    </>
  )
}
