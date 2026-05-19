import { useToastStore } from '../store/toastStore'

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore()
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`px-4 py-3 rounded-xl text-[13px] font-semibold shadow-lg pointer-events-auto cursor-pointer ${
            t.type === 'success'
              ? 'bg-free/15 border border-free/30 text-free'
              : t.type === 'error'
              ? 'bg-busy/15 border border-busy/30 text-busy'
              : 'bg-bg-card border border-border text-text'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
