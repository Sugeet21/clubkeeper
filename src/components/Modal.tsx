import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  // Prevent body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="relative w-full bg-bg-elevated rounded-t-3xl border-t border-border px-5 pt-5 pb-10 z-10">
        {/* Drag handle */}
        <div className="w-10 h-1 bg-border-bright rounded-full mx-auto mb-5" />
        <h4 className="text-[18px] font-bold tracking-tight text-text mb-3">{title}</h4>
        {children}
      </div>
    </div>
  )
}
