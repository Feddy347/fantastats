import { Link, useLocation } from 'react-router-dom'
import './BottomNav.css'

const ICONS = {
  home: (
    <path d="M4 11.5 12 4l8 7.5M6 10v9h5v-5h2v5h5v-9" />
  ),
  swap: (
    <path d="M7 4 4 7l3 3M4 7h14M17 20l3-3-3-3M20 17H6" />
  ),
  live: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </>
  ),
  users: (
    <path d="M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3 2.7-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M15 20c0-2.4 1.8-4.3 4-4.8" />
  ),
  user: (
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3.6-7 8-7s8 3 8 7" />
  ),
}

function Icon({ name }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

const NAV_ITEMS = [
  { to: '/categories', label: 'Home', icon: 'home', matches: ['/categories', '/leagues'] },
  { to: '/live', label: 'Live', icon: 'live', matches: ['/live'] },
  { to: '/market', label: 'Mercato', icon: 'swap', matches: ['/market'] },
  { to: '/roster', label: 'Rosa', icon: 'users', matches: ['/roster'] },
  { to: '/profile', label: 'Profilo', icon: 'user', matches: ['/profile'] },
]

export default function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map((item) => {
        const isActive = item.matches.some((m) => pathname === m || pathname.startsWith(m + '/'))
        return (
          <Link
            key={item.to}
            to={item.to}
            className={'bottom-nav-item' + (isActive ? ' active' : '')}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
