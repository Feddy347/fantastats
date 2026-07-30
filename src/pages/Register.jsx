import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import './Auth.css'

export default function Register() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [teamName, setTeamName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmEmailSent, setConfirmEmailSent] = useState(false)

  if (!authLoading && user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, team_name: teamName } },
    })

    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }

    if (data.session) {
      navigate('/')
    } else {
      setConfirmEmailSent(true)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-title">
          <span className="brand">Fantastats</span>
          <span className="subtitle">Crea un nuovo account</span>
        </div>

        {confirmEmailSent ? (
          <div className="auth-success">
            Controlla la tua email per confermare l'account, poi accedi.
          </div>
        ) : (
          <>
            {error && <div className="error-text">{error}</div>}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="auth-field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  required
                  minLength={3}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="team-name">Nome squadra</label>
                <input
                  id="team-name"
                  type="text"
                  required
                  minLength={2}
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                {submitting ? 'Registrazione in corso…' : 'Registrati'}
              </button>
            </form>
          </>
        )}

        <div className="auth-footer">
          Hai già un account? <Link to="/login">Accedi</Link>
        </div>
      </div>
    </div>
  )
}
