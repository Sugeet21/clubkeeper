interface Props {
  onRetry: () => void
}

export function SigninError({ onRetry }: Props) {
  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[80] flex items-start gap-2.5 px-3.5 py-3 rounded-[14px] text-[13.5px] leading-[1.4] backdrop-blur-md"
      style={{
        maxWidth: '360px',
        width: 'calc(100% - 32px)',
        background: 'rgba(255,107,74,.08)',
        border: '1px solid rgba(255,107,74,.35)',
        boxShadow: '0 20px 40px -20px rgba(0,0,0,.7)',
      }}
      role="alert"
      aria-live="polite"
    >
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-busy text-bg flex items-center justify-center font-bold text-[13px] mt-[1px]">
        !
      </span>
      <span className="text-text flex-1">
        <span className="font-bold">Couldn't sign in with Google.</span>
        <br />
        Check your internet connection and try again.
      </span>
      <button
        onClick={onRetry}
        className="ml-2 flex-shrink-0 text-accent font-semibold text-[13px] px-1.5 py-1"
      >
        Retry
      </button>
    </div>
  )
}
