import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import './Profile.css'

export default function Profile() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="profile-page">
      <h1>Profilo</h1>

      <div className="profile-card card">
        <div className="profile-row">
          <span className="summary-label">Username</span>
          <span>{profile?.username ?? '—'}</span>
        </div>
        <div className="profile-row">
          <span className="summary-label">Email</span>
          <span>{user?.email}</span>
        </div>
        <div className="profile-row">
          <span className="summary-label">Crediti</span>
          <span>{profile?.credits ?? 0}</span>
        </div>
      </div>

      <button type="button" className="btn btn-secondary btn-block" onClick={handleLogout}>
        Esci
      </button>
    </div>
  )
}
