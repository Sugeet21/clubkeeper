import { NavLink } from 'react-router-dom'

const tabs = [
  {
    to: '/tables',
    label: 'Tables',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="5" cy="10" r="1.5" fill="currentColor" />
        <circle cx="15" cy="10" r="1.5" fill="currentColor" />
        <line x1="2" y1="8" x2="18" y2="8" stroke="currentColor" strokeWidth="1.5" />
        <line x1="2" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    to: '/summary',
    label: 'Summary',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="14" width="3" height="4" rx="1" fill="currentColor" />
        <rect x="8.5" y="9" width="3" height="9" rx="1" fill="currentColor" />
        <rect x="14" y="5" width="3" height="13" rx="1" fill="currentColor" />
        <path d="M4.5 13L10 8L15.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/history',
    label: 'History',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.4 4.4l1.4 1.4M14.2 14.2l1.4 1.4M15.6 4.4l-1.4 1.4M5.8 14.2l-1.4 1.4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
]

export default function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 h-16 bg-bg/90 backdrop-blur-xl border-t border-border grid grid-cols-4"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/tables'}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-0.5 transition-colors ${
              isActive ? 'text-accent' : 'text-text-faint'
            }`
          }
        >
          {tab.icon}
          <span className="text-[9px] uppercase tracking-widest leading-none">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
