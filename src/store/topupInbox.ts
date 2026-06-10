import { create } from 'zustand'

interface TopupInboxState {
  pendingCount: number
  modalOpen: boolean
  setPendingCount: (count: number) => void
  incrementPending: () => void
  decrementPending: () => void
  openModal: () => void
  closeModal: () => void
}

export const useTopupInbox = create<TopupInboxState>((set, get) => ({
  pendingCount: 0,
  modalOpen: false,
  setPendingCount: (count) => set({ pendingCount: Math.max(0, count) }),
  incrementPending: () => set({ pendingCount: get().pendingCount + 1 }),
  decrementPending: () => set({ pendingCount: Math.max(0, get().pendingCount - 1) }),
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
}))

/** Single selector for the badge count — use this everywhere instead of reading pendingCount directly. */
export function usePendingTopupCount() {
  return useTopupInbox((s) => s.pendingCount)
}
