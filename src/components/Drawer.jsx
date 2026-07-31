import { useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { Home, Zap, User, LogOut } from 'lucide-react'
import { useAuth } from '../lib/useAuth'
import './Drawer.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/live', label: 'Live', icon: Zap },
  { to: '/profile', label: 'Profilo', icon: User },
]

// Swipe-right-to-close, since a drawer sliding in from the right is closed
// by swiping back the way it came.
const SWIPE_CLOSE_THRESHOLD = 60

export default function Drawer({ open, onClose }) {
  const { profile, signOut } = useAuth()
  const touchStartX = useRef(null)

  async function handleSignOut() {
    onClose()
    await signOut()
  }

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
                  <item.icon size={20} strokeWidth={2} />
                </span>
                {item.label}
              </NavLink>
            </li>
          ))}
          <li>
            <button type="button" className="drawer-nav-item drawer-nav-signout" onClick={handleSignOut}>
              <span className="drawer-nav-icon" aria-hidden="true">
                <LogOut size={20} strokeWidth={2} />
              </span>
              Esci
            </button>
          </li>
        </ul>

        <div className="drawer-footer">
          <div className="drawer-footer-username">{profile?.username ?? '—'}</div>
          {profile?.team_name && <div className="drawer-footer-team">{profile.team_name}</div>}
          <div className="drawer-footer-credits">{profile?.credits ?? 0} / 500</div>
        </div>
      </nav>
    </>
  )
}
