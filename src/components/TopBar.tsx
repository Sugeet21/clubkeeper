import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { usePendingTopupCount } from '../store/topupInbox'
import { usePendingBookingCount } from '../store/bookingInbox'
import { useSettings } from '../hooks/useLiveData'

interface Props {
  onWalletPress?: () => void
  onQuickSalePress?: () => void
}

export default function TopBar({ onWalletPress, onQuickSalePress }: Props) {
  const navigate = useNavigate()
  const subtitle = format(new Date(), "EEE · d MMM · h:mm a")
  const [online, setOnline] = useState(navigator.onLine)
  const pendingTopups = usePendingTopupCount()
  const pendingBookings = usePendingBookingCount()
  const settings = useSettings()
  // Booking icon only renders when the owner has opted in. settings.slug is
  // also required because the realtime channel needs a clubs row to exist.
  const showBookingIcon = Boolean(settings?.slug && settings?.acceptsBookings)

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
    <div className="pt-4 pb-3">
      {/* Top row: heading + icons (icon group unchanged) */}
      <div className="flex items-start justify-between">
        <h1 className="text-[22px] font-bold tracking-tight text-text leading-tight">Today</h1>
        <div className="flex items-center gap-1 mt-0.5">
        {!online && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-text-faint mr-1">
            <span className="w-1.5 h-1.5 rounded-full bg-text-faint shrink-0" />
            Offline
          </span>
        )}
        {online && (
          <span className="w-1.5 h-1.5 rounded-full bg-free shrink-0 mr-1" />
        )}
        {/* Bookings button — between online dot and canteen. Only shown when
            the club has opted in. Sky/blue dot distinguishes booking pending
            from the amber topup pending dot on the wallet icon next to it. */}
        {showBookingIcon && (
          <button
            onClick={() => navigate('/bookings')}
            className="w-9 h-9 relative flex items-center justify-center rounded-xl text-text-dim hover:text-text hover:bg-bg-elevated transition-colors"
            aria-label="Bookings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {pendingBookings > 0 && (
              <span
                className="absolute top-1 right-1 w-2 h-2 rounded-full bg-sky-400"
                aria-hidden="true"
              />
            )}
          </button>
        )}
        {/* Canteen button — between online dot and wallet */}
        <button
          onClick={() => navigate('/canteen')}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-text-dim hover:text-text hover:bg-bg-elevated transition-colors"
          aria-label="Canteen management"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
          </svg>
        </button>
        {/* Wallet button — between canteen and gear */}
        <button
          onClick={onWalletPress ?? (() => navigate('/wallet'))}
          className="w-9 h-9 relative flex items-center justify-center rounded-xl text-text-dim hover:text-text hover:bg-bg-elevated transition-colors"
          aria-label="Wallet"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect x="1" y="4" width="22" height="16" rx="3" ry="3" />
            <path d="M1 10h22" />
            <circle cx="17" cy="15" r="1.5" fill="currentColor" stroke="none" />
          </svg>
          {pendingTopups > 0 && (
            <span
              className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400"
              aria-hidden="true"
            />
          )}
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-text-dim hover:text-text hover:bg-bg-elevated transition-colors -mr-0.5"
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
      {/* Subtitle row — date on the left, optional Quick Sale pill on the right.
          py-1 keeps the visible row height ≥ 12px text + ~16px button = 36px,
          and the pill's own h-9 (36px) inside py-1 (8px each side) gives a
          52px total tap zone — comfortably above 44px. */}
      <div className="flex items-center justify-between mt-1 py-1 gap-2">
        <p className="text-[12px] text-text-dim font-mono truncate min-w-0">{subtitle}</p>
        {onQuickSalePress && (
          <button
            onClick={onQuickSalePress}
            className="h-9 px-3.5 rounded-full bg-accent text-bg text-[12px] font-semibold flex items-center gap-1 shrink-0 active:scale-95 transition-transform"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Quick Sale
          </button>
        )}
      </div>
    </div>
  )
}
