import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { usePageTitle } from '../hooks/usePageTitle'
import '../components/CreateLeagueModal.css'
import './Profile.css'

// Matches the `credits` column's default in the Phase 2 migration — there's
// no per-user "initial credits" column since every categories profile
// starts at the same fixed amount.
const STARTING_CREDITS = 500

export default function Profile() {
  usePageTitle('Profilo')
  const { user, profile, signOut, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [teamName, setTeamName] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)
  const [accountError, setAccountError] = useState(null)
  const [accountSuccess, setAccountSuccess] = useState(false)

  const [resetSending, setResetSending] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState(null)

  const [defaultHome, setDefaultHome] = useState('categories')
  const [savingPrefs, setSavingPrefs] = useState(false)

  const [myLeagues, setMyLeagues] = useState([])
  const [leaguesLoading, setLeaguesLoading] = useState(true)

  useEffect(() => {
    function syncFromProfile() {
      if (!profile) return
      setUsername(profile.username ?? '')
      setTeamName(profile.team_name ?? '')
      setDefaultHome(profile.default_home ?? 'categories')
    }
    syncFromProfile()
  }, [profile])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLeaguesLoading(true)
      const { data } = await supabase
        .from('league_members')
        .select('is_admin, leagues(id, name)')
        .eq('user_id', user.id)
      if (!cancelled) {
        setMyLeagues((data ?? []).filter((r) => r.leagues))
        setLeaguesLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user.id])

  async function handleLogout() {
    await signOut()
    navigate('/login')
  }

  async function handleSaveAccount(e) {
    e.preventDefault()
    setSavingAccount(true)
    setAccountError(null)
    setAccountSuccess(false)

    const { error } = await supabase
      .from('profiles')
      .update({ username: username.trim(), team_name: teamName.trim() })
      .eq('id', user.id)

    setSavingAccount(false)

    if (error) {
      setAccountError(
        error.message.includes('duplicate') || error.code === '23505'
          ? 'Username già in uso.'
          : 'Salvataggio non riuscito.'
      )
      return
    }

    await refreshProfile()
    setAccountSuccess(true)
  }

  async function handleResetPassword() {
    setResetSending(true)
    setResetError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/login`,
    })
    setResetSending(false)
    if (error) {
      setResetError('Invio email non riuscito.')
      return
    }
    setResetSent(true)
  }

  async function handleDefaultHomeChange(value) {
    setDefaultHome(value)
    setSavingPrefs(true)
    await supabase.from('profiles').update({ default_home: value }).eq('id', user.id)
    setSavingPrefs(false)
    await refreshProfile()
  }

  return (
    <div className="profile-page">
      <h1>Profilo</h1>

      <div className="profile-card card">
        <div className="profile-row">
          <span className="summary-label">Email</span>
          <span>{user?.email}</span>
        </div>
        <div className="profile-row">
          <span className="summary-label">Crediti</span>
          <span className="summary-value">
            {profile?.credits ?? 0} / {STARTING_CREDITS}
          </span>
        </div>
      </div>

      <section className="card profile-section">
        <h2>Il tuo account</h2>
        <form onSubmit={handleSaveAccount} className="profile-form">
          <div className="form-field">
            <label htmlFor="profile-username">Username</label>
            <input
              id="profile-username"
              type="text"
              required
              minLength={3}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="profile-team-name">Nome squadra</label>
            <input
              id="profile-team-name"
              type="text"
              required
              minLength={2}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
          </div>

          {accountError && <p className="error-text">{accountError}</p>}
          {accountSuccess && <p className="success-text">Salvato.</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={savingAccount}>
            {savingAccount ? 'Salvataggio…' : 'Salva modifiche'}
          </button>
        </form>

        <div className="profile-divider" />

        {resetSent ? (
          <p className="success-text">Controlla la tua email per reimpostare la password.</p>
        ) : (
          <button type="button" className="btn btn-secondary btn-block" disabled={resetSending} onClick={handleResetPassword}>
            {resetSending ? 'Invio…' : 'Reimposta password'}
          </button>
        )}
        {resetError && <p className="error-text">{resetError}</p>}
      </section>

      <section className="card profile-section">
        <h2>Preferenze</h2>
        <div className="form-field">
          <span className="form-label">Home di default</span>
          <div className="radio-row">
            <label className="radio-option">
              <input
                type="radio"
                checked={defaultHome === 'categories'}
                disabled={savingPrefs}
                onChange={() => handleDefaultHomeChange('categories')}
              />
              Categorie
            </label>
            <label className="radio-option">
              <input
                type="radio"
                checked={defaultHome === 'leagues'}
                disabled={savingPrefs}
                onChange={() => handleDefaultHomeChange('leagues')}
              />
              Leghe
            </label>
          </div>
        </div>
      </section>

      <section className="card profile-section">
        <h2>Le tue leghe</h2>
        {leaguesLoading ? (
          <p className="status-text">Caricamento…</p>
        ) : myLeagues.length === 0 ? (
          <p className="status-text">Non fai parte di nessuna lega.</p>
        ) : (
          <ul className="player-rows">
            {myLeagues.map((r) => (
              <li key={r.leagues.id} className="player-row card">
                <div className="player-main">
                  <Link to={`/leagues/${r.leagues.id}`} className="player-name">
                    {r.leagues.name}
                  </Link>
                </div>
                <span className="badge-tag">{r.is_admin ? 'Admin' : 'Membro'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="btn btn-secondary btn-block" onClick={handleLogout}>
        Esci
      </button>
    </div>
  )
}
