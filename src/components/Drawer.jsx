import { useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import './Drawer.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/categories', label: 'Categorie', icon: '📂' },
  { to: '/leagues', label: 'Leghe', icon: '🏆' },
  { to: '/live', label: 'Live', icon: '⚡' },
  { to: '/market', label: 'Mercato', icon: '🔄' },
  { to: '/roster', label: 'Rosa', icon: '👤' },
  { to: '/profile', label: 'Profilo', icon: '⚙️' },
]

// Swipe-right-to-close, since a drawer sliding in from the right is closed
// by swiping back the way it came.
const SWIPE_CLOSE_THRESHOLD = 60

export default function Drawer({ open, onClose }) {
  const { profile } = useAuth()
  const touchStartX = useRef(null)

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e) {
    if (touchStartX.current == null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    if (delta > SWIPE_CLOSE_THRESHOLD) onClose()
    touchStartX.current = null
  }

  return (
    <>
      <div className={'drawer-overlay' + (open ? ' open' : '')} onClick={onClose} aria-hidden="true" />
      <nav
        className={'drawer' + (open ? ' open' : '')}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        aria-label="Menu principale"
      >
        <div className="drawer-header">
          <span>Menu</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Chiudi menu">
            ×
          </button>
        </div>

        <ul className="drawer-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.label}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => 'drawer-nav-item' + (isActive ? ' active' : '')}
                onClick={onClose}
              >
                <span className="drawer-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="drawer-footer">
          <div className="drawer-footer-username">{profile?.username ?? '—'}</div>
          <div className="drawer-footer-credits">{profile?.credits ?? 0} crediti</div>
        </div>
      </nav>
    </>
  )
}
