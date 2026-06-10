import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

export default function PlayerScanLayout({ children }: Props) {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-start px-4 pt-8 pb-10">
      <div className="w-full max-w-sm">
        {children}
      </div>
      <p className="mt-8 text-[11px] text-text-faint">Powered by ClubKeeper</p>
    </div>
  )
}
