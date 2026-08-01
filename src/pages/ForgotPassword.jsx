import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import './Auth.css'

export default function ForgotPassword() {
  const { user, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  if (!authLoading && user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSubmitting(false)
    if (error) {
      setError('Invio email non riuscito.')
      return
    }
    setSent(true)
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-title">
          <span className="brand">Fantastats</span>
          <span className="subtitle">Reimposta la password</span>
        </div>

        {sent ? (
          <div className="auth-success">
            Se l'indirizzo è registrato, controlla la tua email per il link di reimpostazione.
          </div>
        ) : (
          <>
            {error && <div className="error-text">{error}</div>}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
              <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                {submitting ? 'Invio…' : 'Invia link di reimpostazione'}
              </button>
            </form>
          </>
        )}

        <div className="auth-footer">
          <Link to="/login">Torna al login</Link>
        </div>
      </div>
    </div>
  )
}
