import { useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Home, Zap, Goal, BarChart3, User, LogOut, Calculator } from 'lucide-react'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabaseClient'
import './Drawer.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/live', label: 'Live', icon: Zap },
  { to: '/serie-a', label: 'Serie A', icon: Goal },
  { to: '/statistiche', label: 'Statistiche', icon: BarChart3 },
  { to: '/profile', label: 'Profilo', icon: User },
]

// Single hardcoded admin account — the only one allowed to trigger gameweek
// calculation. Matches api/calculate-gameweek.js's own server-side check
// (the button being hidden here is just UX, not the real gate).
const GAMEWEEK_ADMIN_USER_ID = '77e2ac11-32cc-44d2-8d1f-2b78bb11ec69'

// Swipe-right-to-close, since a drawer sliding in from the right is closed
// by swiping back the way it came.
const SWIPE_CLOSE_THRESHOLD = 60

export default function Drawer({ open, onClose }) {
  const { user, profile, signOut } = useAuth()
  const touchStartX = useRef(null)
  const [calculating, setCalculating] = useState(false)
  const [calcResult, setCalcResult] = useState(null)
  const [calcError, setCalcError] = useState(null)

  async function handleSignOut() {
    onClose()
    await signOut()
  }

  async function handleCalculateGameweek() {
    setCalculating(true)
    setCalcResult(null)
    setCalcError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const response = await fetch('/api/calculate-gameweek', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error || 'Calcolo non riuscito')

      const gwNumber = body.categories?.gameweekNumber ?? body.leagues?.gameweekNumber ?? body.poll?.gameweekNumber
      setCalcResult(
        `Giornata ${gwNumber ?? '?'} calcolata: ${body.poll?.statsUpdated ?? 0} statistiche, ` +
          `${body.categories?.categoriesConsolidated ?? 0} categorie, ${body.leagues?.leaguesConsolidated ?? 0} leghe aggiornate.`
      )
    } catch (err) {
      setCalcError(err.message || 'Calcolo non riuscito. Riprova.')
    } finally {
      setCalculating(false)
    }
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
          {user?.id === GAMEWEEK_ADMIN_USER_ID && (
            <li>
              <button
                type="button"
                className="drawer-nav-item"
                onClick={handleCalculateGameweek}
                disabled={calculating}
              >
                <span className="drawer-nav-icon" aria-hidden="true">
                  <Calculator size={20} strokeWidth={2} />
                </span>
                {calculating ? 'Calcolo in corso…' : 'Calcola giornata'}
              </button>
              {calcResult && <p className="drawer-calc-feedback drawer-calc-success">{calcResult}</p>}
              {calcError && <p className="drawer-calc-feedback drawer-calc-error">{calcError}</p>}
            </li>
          )}
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
