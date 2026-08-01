import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import './Auth.css'

// Public page reached from the password-recovery email link. Deliberately
// does not use AuthContext/useAuth: Login/Register redirect any signed-in
// user to "/", which would hijack the temporary recovery session before the
// user can set a new password. This page tracks its own session state via
// the PASSWORD_RECOVERY auth event instead.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
      setChecking(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
        setChecking(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) {
      setError('Impossibile aggiornare la password.')
      return
    }
    setDone(true)
    setTimeout(() => navigate('/'), 1500)
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-title">
          <span className="brand">Fantastats</span>
          <span className="subtitle">Imposta una nuova password</span>
        </div>

        {checking && <p className="status-text">Verifica del link…</p>}

        {!checking && !ready && !done && (
          <>
            <div className="error-text">Link non valido o scaduto.</div>
            <div className="auth-footer">
              <Link to="/forgot-password">Richiedi un nuovo link</Link>
            </div>
          </>
        )}

        {ready && !done && (
          <>
            {error && <div className="error-text">{error}</div>}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="auth-field">
                <label htmlFor="new-password">Nuova password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                {submitting ? 'Salvataggio…' : 'Salva nuova password'}
              </button>
            </form>
          </>
        )}

        {done && <div className="auth-success">Password aggiornata. Reindirizzamento…</div>}
      </div>
    </div>
  )
}
