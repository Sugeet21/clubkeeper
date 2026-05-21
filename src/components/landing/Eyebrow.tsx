export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-text-faint font-medium">
      <span className="flex-shrink-0 w-[18px] h-px bg-text-faint" />
      {children}
    </div>
  )
}
