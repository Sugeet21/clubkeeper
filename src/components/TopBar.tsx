import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'

export default function TopBar() {
  const navigate = useNavigate()
  const subtitle = format(new Date(), "EEE · d MMM · h:mm a")
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return (
    <div className="flex items-start justify-between pt-4 pb-3">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-text leading-tight">Today</h1>
        <p className="text-[12px] text-text-dim font-mono mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5">
        {!online && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-text-faint">
            <span className="w-1.5 h-1.5 rounded-full bg-text-faint shrink-0" />
            Offline
          </span>
        )}
        {online && (
          <span className="w-1.5 h-1.5 rounded-full bg-free shrink-0" />
        )}
        <button
          onClick={() => navigate('/settings')}
          className="w-11 h-11 flex items-center justify-center rounded-xl text-text-dim hover:text-text hover:bg-bg-elevated transition-colors -mr-1"
          aria-label="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7l-1.3 1.3M6 14l-1.3 1.3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
