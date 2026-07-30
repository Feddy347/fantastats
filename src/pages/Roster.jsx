import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import PlayerRow from '../components/PlayerRow'
import { buildTeamsByName, eligibleCategoriesForPlayer } from '../lib/categoryPool'
import { usePageTitle } from '../hooks/usePageTitle'
import './Roster.css'

const ROLE_ORDER = ['POR', 'DC', 'T', 'C', 'ES', 'Tq', 'ATT']

export default function Roster() {
  usePageTitle('Rosa')
  const { user, profile } = useAuth()
  const [players, setPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [categories, setCategories] = useState([])
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [playersRes, teamsRes, categoriesRes, rosterRes] = await Promise.all([
        supabase.from('players').select('*'),
        supabase.from('teams').select('*'),
        supabase.from('categories').select('*').eq('is_active', true).eq('is_event', false).order('id'),
        supabase.from('user_players').select('player_id, purchase_price').eq('user_id', user.id),
      ])

      if (cancelled) return

      if (rosterRes.error) setError('Impossibile caricare la rosa.')
      setPlayers(playersRes.data ?? [])
      setTeams(teamsRes.data ?? [])
      setCategories(categoriesRes.data ?? [])
      setRoster(rosterRes.data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user.id])

  const teamsByName = useMemo(() => buildTeamsByName(teams), [teams])
  const totalTeams = teams.length

  const rosterByPlayerId = useMemo(() => {
    const map = {}
    roster.forEach((r) => {
      map[r.player_id] = r
    })
    return map
  }, [roster])

  const rosterPlayers = useMemo(
    () => players.filter((p) => rosterByPlayerId[p.id]),
    [players, rosterByPlayerId]
  )

  const totalValue = rosterPlayers.reduce((sum, p) => sum + (p.price_current ?? 0), 0)

  const groups = useMemo(() => {
    const byRole = {}
    rosterPlayers.forEach((p) => {
      const primaryRole = (p.role_fantastats ?? '').split(';')[0].trim() || 'Altro'
      if (!byRole[primaryRole]) byRole[primaryRole] = []
      byRole[primaryRole].push(p)
    })
    const orderedKeys = [
      ...ROLE_ORDER.filter((r) => byRole[r]),
      ...Object.keys(byRole).filter((r) => !ROLE_ORDER.includes(r)),
    ]
    return orderedKeys.map((role) => ({ role, players: byRole[role] }))
  }, [rosterPlayers])

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  return (
    <div className="roster-page">
      <h1>La tua rosa</h1>

      <div className="roster-stats card">
        <div className="summary-item">
          <span className="summary-label">Giocatori</span>
          <span className="summary-value">{rosterPlayers.length}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Valore rosa</span>
          <span className="summary-value">{totalValue}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Crediti</span>
          <span className="summary-value">{profile?.credits ?? 0}</span>
        </div>
      </div>

      {rosterPlayers.length === 0 && <p className="status-text">Non hai ancora giocatori in rosa.</p>}

      {groups.map((group) => (
        <section key={group.role} className="roster-group">
          <h2>
            {group.role} <span className="roster-group-count">({group.players.length})</span>
          </h2>
          <ul className="player-rows">
            {group.players.map((p) => {
              const purchasePrice = rosterByPlayerId[p.id]?.purchase_price ?? 0
              const badges = eligibleCategoriesForPlayer(p, teamsByName, categories, totalTeams).map(
                (c) => c.name
              )
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  badges={badges}
                  meta={
                    <>
                      <span>
                        Acquisto: <strong>{purchasePrice}</strong>
                      </span>
                      <span>
                        Attuale: <strong>{p.price_current}</strong>
                      </span>
                    </>
                  }
                />
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
