import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import HomeTabs from '../components/HomeTabs'
import CreateLeagueModal from '../components/CreateLeagueModal'
import { usePageTitle } from '../hooks/usePageTitle'
import './Categories.css'
import './LeaguesList.css'

const STATUS_LABELS = { setup: 'In allestimento', active: 'In corso', completed: 'Conclusa' }

export default function LeaguesList() {
  usePageTitle('Leghe')
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [leagues, setLeagues] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const [inviteCode, setInviteCode] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [searching, setSearching] = useState(false)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  async function loadLeagues() {
    setLoading(true)
    const { data } = await supabase
      .from('league_members')
      .select('league_id, team_name, is_admin, leagues(*)')
      .eq('user_id', user.id)

    const rows = data ?? []
    const leagueIds = rows.map((r) => r.league_id)

    let counts = {}
    if (leagueIds.length > 0) {
      const { data: memberRows } = await supabase.from('league_members').select('league_id').in('league_id', leagueIds)
      ;(memberRows ?? []).forEach((r) => {
        counts[r.league_id] = (counts[r.league_id] ?? 0) + 1
      })
    }

    setLeagues(
      rows
        .filter((r) => r.leagues)
        .map((r) => ({
          ...r.leagues,
          myTeamName: r.team_name,
          isAdmin: r.is_admin,
          memberCount: counts[r.league_id] ?? 0,
        }))
    )
    setLoading(false)
  }

  useEffect(() => {
    async function run() {
      await loadLeagues()
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  async function handleSearchCode(e) {
    e.preventDefault()
    setSearching(true)
    setPreviewError(null)
    setPreview(null)
    setJoinError(null)

    const code = inviteCode.trim().toUpperCase()
    const { data, error } = await supabase.rpc('get_league_preview', { p_invite_code: code })

    setSearching(false)

    if (error || !data || data.length === 0) {
      setPreviewError('Nessuna lega trovata con questo codice.')
      return
    }

    setPreview(data[0])
  }

  async function handleJoin() {
    if (!preview) return
    setJoining(true)
    setJoinError(null)

    const { error } = await supabase.from('league_members').insert({
      league_id: preview.league_id,
      user_id: user.id,
      team_name: profile?.team_name || profile?.username,
      league_credits: preview.starting_credits,
    })

    setJoining(false)

    if (error) {
      setJoinError('Impossibile unirsi. La lega potrebbe aver già iniziato la stagione.')
      return
    }

    navigate(`/leagues/${preview.league_id}`)
  }

  return (
    <div className="categories-page">
      <HomeTabs />

      <button type="button" className="btn btn-primary btn-block" onClick={() => setShowCreate(true)}>
        Crea lega
      </button>

      <div className="join-league card">
        <h2>Unisciti con un codice</h2>
        <form className="join-league-form" onSubmit={handleSearchCode}>
          <input
            type="text"
            placeholder="Codice invito"
            maxLength={6}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
          />
          <button type="submit" className="btn btn-secondary" disabled={searching || !inviteCode.trim()}>
            {searching ? 'Cerco…' : 'Cerca'}
          </button>
        </form>

        {previewError && <p className="error-text">{previewError}</p>}

        {preview && (
          <div className="league-preview">
            <p className="league-preview-name">{preview.name}</p>
            <div className="category-stats">
              <span>Admin: {preview.admin_username}</span>
              <span>{preview.member_count} partecipanti</span>
            </div>
            <div className="category-stats">
              <span>Formazione {preview.formation_type}</span>
              <span>{preview.market_type === 'auction' ? 'Asta in presenza' : 'Crediti'}</span>
            </div>

            {joinError && <p className="error-text">{joinError}</p>}

            <button type="button" className="btn btn-primary btn-block" disabled={joining} onClick={handleJoin}>
              {joining ? 'Iscrizione…' : 'Unisciti'}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="status-text">Caricamento…</p>
      ) : leagues.length === 0 ? (
        <p className="status-text">Non fai ancora parte di nessuna lega.</p>
      ) : (
        <div className="category-cards">
          {leagues.map((league) => (
            <Link key={league.id} to={`/leagues/${league.id}`} className="category-card card category-card-link">
              <div className="category-card-header">
                <h2>{league.name}</h2>
                {(league.isAdmin || league.admin_id === user.id) && <span className="badge-tag">Admin</span>}
              </div>
              <p className="category-description">{league.myTeamName}</p>
              <div className="category-stats">
                <span>{league.memberCount} partecipanti</span>
                <span>Formazione {league.formation_type}</span>
              </div>
              <div className="category-stats">
                <span>{STATUS_LABELS[league.status] ?? league.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && <CreateLeagueModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
