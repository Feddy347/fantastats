import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { usePageTitle } from '../hooks/usePageTitle'
import './TeamPage.css'

const ROLE_ORDER = ['POR', 'DC', 'T', 'C', 'ES', 'Tq', 'ATT']

function primaryRole(player) {
  return (player.role_fantastats ?? '').split(';')[0].trim()
}

function formatMatchDate(iso) {
  return new Date(iso).toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TeamPage() {
  const { name } = useParams()
  const decodedName = decodeURIComponent(name)

  const [team, setTeam] = useState(null)
  const [teamMissing, setTeamMissing] = useState(false)
  const [players, setPlayers] = useState([])
  const [nextMatch, setNextMatch] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  usePageTitle(decodedName)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const [teamRes, playersRes, matchRes] = await Promise.all([
        supabase.from('teams').select('*').eq('name', decodedName).maybeSingle(),
        supabase.from('players').select('*').eq('team', decodedName).order('name'),
        supabase
          .from('matches')
          .select('*')
          .or(`home_team.eq.${decodedName},away_team.eq.${decodedName}`)
          .eq('status', 'upcoming')
          .order('starts_at', { ascending: true })
          .limit(1),
      ])

      if (cancelled) return

      if (playersRes.error) {
        setError('Impossibile caricare la squadra.')
        setLoading(false)
        return
      }

      setTeam(teamRes.data ?? null)
      setTeamMissing(!teamRes.data)
      setPlayers(playersRes.data ?? [])
      setNextMatch(matchRes.data?.[0] ?? null)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [decodedName])

  const rosterByRole = useMemo(() => {
    const groups = {}
    ROLE_ORDER.forEach((role) => {
      groups[role] = []
    })
    groups.Altro = []

    players.forEach((p) => {
      const role = primaryRole(p)
      if (groups[role]) {
        groups[role].push(p)
      } else {
        groups.Altro.push(p)
      }
    })

    return groups
  }, [players])

  const roleGroupOrder = [...ROLE_ORDER, 'Altro']

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  const opponent = nextMatch
    ? nextMatch.home_team === decodedName
      ? nextMatch.away_team
      : nextMatch.home_team
    : null

  return (
    <div className="team-page page-fade">
      <div className="team-page-header card">
        <h1>{decodedName}</h1>
        <p className="team-page-position">
          {teamMissing || team?.league_position == null
            ? 'Posizione non disponibile'
            : `${team.league_position}° in classifica`}
        </p>
      </div>

      {nextMatch && (
        <div className="card team-page-next-match">
          <span className="team-page-next-match-label">Prossima partita</span>
          <span className="team-page-next-match-opponent">{opponent}</span>
          <span className="team-page-next-match-date">{formatMatchDate(nextMatch.starts_at)}</span>
        </div>
      )}

      <div className="team-page-roster">
        {players.length === 0 ? (
          <p className="status-text">Nessun giocatore trovato per questa squadra.</p>
        ) : (
          roleGroupOrder.map((role) => {
            const group = rosterByRole[role]
            if (!group || group.length === 0) return null
            return (
              <div key={role} className="team-page-role-group">
                <h2>{role}</h2>
                <ul className="team-page-players">
                  {group.map((p) => {
                    const age = p.birth_year != null ? new Date().getFullYear() - p.birth_year : null
                    return (
                      <li key={p.id}>
                        <Link to={`/players/${p.id}`} className="team-page-player-row card">
                          <span className="team-page-player-name">{p.name}</span>
                          <span className="role-tag" title="Ruolo Fantastats">
                            {p.role_fantastats}
                          </span>
                          {p.nationality && <span className="nationality-tag">{p.nationality}</span>}
                          {age != null && <span className="team-page-player-age">{age} anni</span>}
                          <span className="team-page-player-price">{p.price_current}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
