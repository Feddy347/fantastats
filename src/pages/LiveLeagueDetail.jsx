import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { getCurrentGameweek } from '../lib/gameweek'
import { getLeagueModuleSystem } from '../lib/leagueModules'
import { getMatchByTeamMap, computeLeagueMemberScore } from '../lib/leagueScoring'
import { usePageTitle } from '../hooks/usePageTitle'
import LiveLeagueLeaderboard from '../components/LiveLeagueLeaderboard'
import './LiveDetail.css'

export default function LiveLeagueDetail() {
  const { leagueId } = useParams()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [league, setLeague] = useState(null)
  const [gameweek, setGameweek] = useState(null)
  const [myTotal, setMyTotal] = useState(0)
  const [myRank, setMyRank] = useState(null)

  usePageTitle(league?.name ?? 'Live')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const { data: leagueData } = await supabase.from('leagues').select('*').eq('id', leagueId).maybeSingle()
      if (cancelled) return
      if (!leagueData) {
        setError('Lega non trovata.')
        setLoading(false)
        return
      }

      const gw = await getCurrentGameweek()
      if (cancelled) return
      if (!gw) {
        setError('Nessuna giornata disponibile.')
        setLoading(false)
        return
      }

      setLeague(leagueData)
      setGameweek(gw)

      if (gw.status === 'live') {
        const roleField = getLeagueModuleSystem(leagueData).roleField
        const [{ data: members }, matchByTeam] = await Promise.all([
          supabase.from('league_members').select('user_id').eq('league_id', leagueId),
          getMatchByTeamMap(supabase, gw.id),
        ])

        if (cancelled) return

        const totals = []
        for (const m of members ?? []) {
          const result = await computeLeagueMemberScore(supabase, {
            leagueId: Number(leagueId),
            userId: m.user_id,
            gameweekId: gw.id,
            roleField,
            matchByTeam,
            isReverse: leagueData.is_reverse_scoring,
          })
          totals.push({ userId: m.user_id, total: result.total })
        }

        if (cancelled) return

        totals.sort((a, b) => b.total - a.total)
        const mine = totals.find((t) => t.userId === user.id)
        const rank = mine ? totals.filter((t) => t.total > mine.total).length + 1 : null

        setMyTotal(mine?.total ?? 0)
        setMyRank(rank)
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [leagueId, user.id])

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  return (
    <div className="live-detail-page">
      <Link to="/live" className="back-link">
        ‹ Live
      </Link>

      <div className="live-detail-header card">
        <h1>
          {league.is_reverse_scoring && <span aria-hidden="true">🔄 </span>}
          {league.name}
        </h1>
        {league.is_reverse_scoring && <span className="badge-tag reverse">Flop XI</span>}
        <div className="live-detail-stats">
          <div className="summary-item">
            <span className="summary-label">Punteggio</span>
            <span className="summary-value">{myTotal.toFixed(1)}</span>
          </div>
          {myRank != null && (
            <div className="summary-item">
              <span className="summary-label">Posizione</span>
              <span className="summary-value">{myRank}°</span>
            </div>
          )}
        </div>
      </div>

      <section>
        <h2>Classifica di giornata</h2>
        <LiveLeagueLeaderboard league={league} gameweek={gameweek} currentUserId={user.id} />
      </section>
    </div>
  )
}
