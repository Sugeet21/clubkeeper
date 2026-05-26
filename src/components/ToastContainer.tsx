import { useToastStore } from '../store/toastStore'

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore()
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-4 left-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-[13px] font-semibold shadow-lg pointer-events-auto ${
            t.type === 'success'
              ? 'bg-free/15 border border-free/30 text-free'
              : t.type === 'error'
              ? 'bg-busy/15 border border-busy/30 text-busy'
              : 'bg-bg-card border border-border text-text'
          }`}
        >
          <span className="flex-1 cursor-pointer" onClick={() => dismiss(t.id)}>
            {t.message}
          </span>
          {t.actionLabel && t.onAction && (
            <button
              onClick={() => {
                t.onAction?.()
                dismiss(t.id)
              }}
              className="shrink-0 text-accent font-bold text-[13px] min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
