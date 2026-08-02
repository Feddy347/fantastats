import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import HomeTabs from '../components/HomeTabs'
import HomeSearch from '../components/HomeSearch'
import NextMatchCountdown from '../components/NextMatchCountdown'
import CreateLeagueModal from '../components/CreateLeagueModal'
import { getCurrentGameweek } from '../lib/gameweek'
import { usePageTitle } from '../hooks/usePageTitle'
import './Categories.css'
import './LeaguesList.css'

const STATUS_LABELS = { setup: 'In allestimento', active: 'In corso', completed: 'Conclusa' }
const DIRECT_FORMATS = ['direct_serie_a', 'direct_vote_sum']
const FORMAT_LABELS = {
  direct_serie_a: 'Scontri diretti',
  direct_vote_sum: 'Somma voti',
  royal_rumble_seria: 'Royal rumble',
  royal_rumble_f1: 'Royal rumble F1',
}

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

    const rows = (data ?? []).filter((r) => r.leagues?.status !== 'archived')
    const leagueIds = rows.map((r) => r.league_id)

    let counts = {}
    let standingsByLeague = {}
    let opponentByLeague = {}

    if (leagueIds.length > 0) {
      const [{ data: memberRows }, { data: standingsRows }, gw] = await Promise.all([
        supabase.from('league_members').select('league_id').in('league_id', leagueIds),
        supabase
          .from('league_standings')
          .select('league_id, rank, total_fantasy_score')
          .eq('user_id', user.id)
          .in('league_id', leagueIds),
        getCurrentGameweek(),
      ])

      ;(memberRows ?? []).forEach((r) => {
        counts[r.league_id] = (counts[r.league_id] ?? 0) + 1
      })
      ;(standingsRows ?? []).forEach((r) => {
        standingsByLeague[r.league_id] = r
      })

      const directLeagueIds = rows
        .filter((r) => r.leagues && DIRECT_FORMATS.includes(r.leagues.competition_format))
        .map((r) => r.league_id)

      if (gw && directLeagueIds.length > 0) {
        const { data: calendarRows } = await supabase
          .from('league_calendar')
          .select('id, league_id')
          .eq('gameweek_id', gw.id)
          .in('league_id', directLeagueIds)

        const calendarIds = (calendarRows ?? []).map((c) => c.id)
        const calendarByLeague = {}
        ;(calendarRows ?? []).forEach((c) => {
          calendarByLeague[c.id] = c.league_id
        })

        if (calendarIds.length > 0) {
          const { data: matchupRows } = await supabase
            .from('league_matchups')
            .select('calendar_id, home_user_id, away_user_id')
            .in('calendar_id', calendarIds)
            .or(`home_user_id.eq.${user.id},away_user_id.eq.${user.id}`)

          const opponentIds = (matchupRows ?? []).map((m) =>
            m.home_user_id === user.id ? m.away_user_id : m.home_user_id
          )

          if (opponentIds.length > 0) {
            const { data: opponentProfiles } = await supabase
              .from('profiles')
              .select('id, username, team_name')
              .in('id', opponentIds)

            const profileById = {}
            ;(opponentProfiles ?? []).forEach((p) => {
              profileById[p.id] = p
            })

            ;(matchupRows ?? []).forEach((m) => {
              const oppId = m.home_user_id === user.id ? m.away_user_id : m.home_user_id
              const leagueId = calendarByLeague[m.calendar_id]
              const opp = profileById[oppId]
              if (leagueId && opp) {
                opponentByLeague[leagueId] = opp.team_name || opp.username
              }
            })
          }
        }
      }
    }

    setLeagues(
      rows
        .filter((r) => r.leagues)
        .map((r) => ({
          ...r.leagues,
          myTeamName: r.team_name,
          isAdmin: r.is_admin,
          memberCount: counts[r.league_id] ?? 0,
          rank: standingsByLeague[r.league_id]?.rank ?? null,
          seasonScore: standingsByLeague[r.league_id]?.total_fantasy_score ?? null,
          nextOpponent: opponentByLeague[r.league_id] ?? null,
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
    <div className="categories-page home-background">
      <HomeTabs />

      <HomeSearch />

      <NextMatchCountdown />

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
            <div key={league.id} className="category-card card">
              <Link to={`/leagues/${league.id}`} className="category-card-link">
                <div className="category-card-mutedhead">
                  <span className="category-card-name">{league.name}</span>
                  {(league.isAdmin || league.admin_id === user.id) && <span className="badge-tag">Admin</span>}
                </div>

                <div className="category-card-body">
                  <div className="category-card-score-block">
                    <span className="category-card-score">
                      {league.seasonScore != null ? league.seasonScore.toFixed(1) : '—'}
                    </span>
                    <span className="category-card-score-label">punti</span>
                  </div>
                  {league.rank != null && <span className="category-card-rank">{league.rank}°</span>}
                </div>

                <div className="category-stats league-card-meta">
                  <span>{FORMAT_LABELS[league.competition_format] ?? league.competition_format}</span>
                  <span>{STATUS_LABELS[league.status] ?? league.status}</span>
                </div>

                {league.nextOpponent && (
                  <div className="league-card-opponent">
                    <span>Prossimo avversario</span>
                    <strong>{league.nextOpponent}</strong>
                  </div>
                )}
              </Link>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateLeagueModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
