import { create } from 'zustand'

export type Toast = {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
  actionLabel?: string
  onAction?: () => void
}

type ShowOptions = {
  message: string
  type?: Toast['type']
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}

type ToastStore = {
  toasts: Toast[]
  show: (messageOrOptions: string | ShowOptions, type?: Toast['type']) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (messageOrOptions, type = 'info') => {
    const id = Date.now().toString()
    let toast: Toast
    let duration = 3000

    if (typeof messageOrOptions === 'string') {
      toast = { id, message: messageOrOptions, type }
    } else {
      duration = messageOrOptions.durationMs ?? 3000
      toast = {
        id,
        message: messageOrOptions.message,
        type: messageOrOptions.type ?? 'info',
        actionLabel: messageOrOptions.actionLabel,
        onAction: messageOrOptions.onAction,
      }
    }

    set((s) => ({ toasts: [...s.toasts, toast] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, duration)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
