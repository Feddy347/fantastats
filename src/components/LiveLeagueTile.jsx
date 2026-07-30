import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getLeagueModuleSystem } from '../lib/leagueModules'
import { getMatchByTeamMap, computeLeagueMemberScore } from '../lib/leagueScoring'
import { abbreviatePlayerName } from '../lib/format'
import FlashValue from './FlashValue'

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

// Live tile for a league (alongside the category tiles in Live.jsx). Scores
// are computed client-side via calculateScore/leagueScoring.js rather than
// through a DB function — see that module's header comment for why.
export default function LiveLeagueTile({ league, gameweek, userId, onOpen }) {
  const [loading, setLoading] = useState(true)
  const [myResult, setMyResult] = useState(null)
  const [badge, setBadge] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const roleField = getLeagueModuleSystem(league).roleField
      const matchByTeam = await getMatchByTeamMap(supabase, gameweek.id)
      const mine = await computeLeagueMemberScore(supabase, {
        leagueId: league.id,
        userId,
        gameweekId: gameweek.id,
        roleField,
        matchByTeam,
      })

      if (cancelled) return
      setMyResult(mine)

      const format = league.competition_format

      if (format === 'direct_vote_sum') {
        setBadge({ text: mine.total.toFixed(1) })
      } else if (format.startsWith('direct_')) {
        const { data: calRow } = await supabase
          .from('league_calendar')
          .select('id')
          .eq('league_id', league.id)
          .eq('gameweek_id', gameweek.id)
          .maybeSingle()

        if (calRow) {
          const { data: matchup } = await supabase
            .from('league_matchups')
            .select('*')
            .eq('calendar_id', calRow.id)
            .or(`home_user_id.eq.${userId},away_user_id.eq.${userId}`)
            .maybeSingle()

          if (matchup) {
            const oppId = matchup.home_user_id === userId ? matchup.away_user_id : matchup.home_user_id
            const opp = await computeLeagueMemberScore(supabase, {
              leagueId: league.id,
              userId: oppId,
              gameweekId: gameweek.id,
              roleField,
              matchByTeam,
            })
            if (!cancelled) setBadge({ text: `${mine.total.toFixed(1)} - ${opp.total.toFixed(1)}` })
          }
        }
      } else {
        const { data: members } = await supabase.from('league_members').select('user_id').eq('league_id', league.id)
        const others = (members ?? []).filter((m) => m.user_id !== userId)
        const otherResults = await Promise.all(
          others.map((m) =>
            computeLeagueMemberScore(supabase, {
              leagueId: league.id,
              userId: m.user_id,
              gameweekId: gameweek.id,
              roleField,
              matchByTeam,
            })
          )
        )

        if (cancelled) return

        if (format === 'royal_rumble_seria') {
          let points = 0
          otherResults.forEach((o) => {
            if (mine.total > o.total) points += 3
            else if (mine.total === o.total) points += 1
          })
          setBadge({ text: `${points} pt` })
        } else if (format === 'royal_rumble_f1') {
          const higherCount = otherResults.filter((o) => o.total > mine.total).length
          setBadge({ text: `${higherCount + 1}°` })
        }
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [league, gameweek.id, userId])

  if (loading || !myResult) return null

  const isLiveNow = myResult.players.some((p) => p.isLive)

  return (
    <button type="button" className={'live-tile card' + (isLiveNow ? ' live-now' : '')} onClick={onOpen}>
      <div className="live-tile-header">
        <h2>{league.name}</h2>
        {badge && <span className="live-tile-rank">{badge.text}</span>}
      </div>

      <FlashValue as="div" value={myResult.total} className="live-tile-total">
        {myResult.total.toFixed(1)}
      </FlashValue>

      <ul className="live-tile-players">
        {myResult.players.map((p) => (
          <li key={p.playerId}>
            <span className="role-tag">{p.role}</span>
            <span className="live-tile-player-name">{abbreviatePlayerName(p.name)}</span>
            {p.isLive && <span className="live-dot" aria-label="In corso" />}
            <FlashValue value={p.score} className={'live-tile-score ' + scoreClass(p.score)}>
              {p.score != null ? p.score.toFixed(1) : '—'}
            </FlashValue>
          </li>
        ))}
      </ul>
    </button>
  )
}
