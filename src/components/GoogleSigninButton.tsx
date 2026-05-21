function GoogleLogo() {
  return (
    <svg
      className="w-[22px] h-[22px] flex-shrink-0"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  )
}

interface Props {
  loading?: boolean
  onClick: () => void
}

export function GoogleSigninButton({ loading = false, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 bg-white text-[#0a0e0c] rounded-2xl px-[18px] py-[18px] min-h-[60px] font-semibold text-[16px] tracking-[-0.005em] transition-transform active:translate-y-[1px] disabled:opacity-70"
      style={{
        boxShadow:
          '0 12px 28px -10px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08), inset 0 -2px 0 rgba(0,0,0,.06)',
      }}
    >
      {loading ? (
        <span
          className="w-[18px] h-[18px] rounded-full flex-shrink-0 animate-spin"
          style={{
            border: '2.5px solid rgba(10,14,12,.18)',
            borderTopColor: '#0a0e0c',
          }}
        />
      ) : (
        <GoogleLogo />
      )}
      <span>{loading ? 'Connecting to Google…' : 'Continue with Google'}</span>
    </button>
  )
}
