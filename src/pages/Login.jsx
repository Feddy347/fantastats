import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import './Auth.css'

export default function Login() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (!authLoading && user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) {
      setError('Email o password non corretti.')
      return
    }
    navigate('/')
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <img src="/logo-splash.png" alt="Fantastats" className="auth-logo" />

        <div className="auth-title">
          <span className="brand">Fantastats</span>
          <span className="subtitle">Accedi al tuo account</span>
        </div>

        {error && <div className="error-text">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-field-group" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Accesso in corso…' : 'Accedi'}
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/forgot-password">Password dimenticata?</Link>
        </div>

        <div className="auth-footer">
          Non hai un account? <Link to="/register">Registrati</Link>
        </div>
      </div>
    </div>
  )
}
