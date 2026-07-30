import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useRealtimeScores } from '../hooks/useRealtimeScores'
import PlayerBreakdownModal from './PlayerBreakdownModal'
import './Leaderboard.css'

// Gameweek leaderboard for a category. Once the gameweek is consolidated
// (status 'completed') it reads the authoritative category_gameweek_scores
// (which already include substitutions + rewards). Before that it computes
// a live approximation client-side from lineups + player_match_scores and
// keeps it fresh via useRealtimeScores. Used both by CategoryDetail's
// "Classifica" tab and the Live tile detail view.
export default function GameweekLeaderboard({ categoryId, gameweek, currentUserId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [expandedUserId, setExpandedUserId] = useState(null)
  const [selectedPlayer, setSelectedPlayer] = useState(null)

  const isFinal = gameweek?.status === 'completed'
  const scoresMap = useRealtimeScores(!isFinal ? gameweek?.id : null)

  useEffect(() => {
    let cancelled = false

    async function loadFinal() {
      const [{ data: scoreRows }, { data: rewardRows }] = await Promise.all([
        supabase
          .from('category_gameweek_scores')
          .select('user_id, total_score, rank, profiles(username)')
          .eq('category_id', categoryId)
          .eq('gameweek_id', gameweek.id)
          .order('rank', { ascending: true }),
        supabase
          .from('rewards')
          .select('user_id, reward_type, reward_value')
          .eq('category_id', categoryId)
          .eq('gameweek_id', gameweek.id),
      ])

      if (cancelled) return

      const rewardsByUser = {}
      ;(rewardRows ?? []).forEach((r) => {
        if (!rewardsByUser[r.user_id]) rewardsByUser[r.user_id] = []
        rewardsByUser[r.user_id].push(r)
      })

      setRows(
        (scoreRows ?? []).map((row) => ({
          userId: row.user_id,
          username: row.profiles?.username ?? '—',
          totalScore: row.total_score,
          rank: row.rank,
          rewards: rewardsByUser[row.user_id] ?? [],
          players: null,
        }))
      )
      setLoading(false)
    }

    async function loadLive() {
      const { data: enrollments } = await supabase
        .from('user_category_enrollments')
        .select('user_id, profiles(username)')
        .eq('category_id', categoryId)

      const { data: lineups } = await supabase
        .from('lineups')
        .select('user_id, lineup_players(player_id, slot_role, slot_position, slot_type)')
        .eq('category_id', categoryId)
        .eq('gameweek_id', gameweek.id)

      if (cancelled) return

      const lineupByUser = {}
      ;(lineups ?? []).forEach((l) => {
        lineupByUser[l.user_id] = (l.lineup_players ?? []).filter((lp) => lp.slot_type === 'starter')
      })

      const allPlayerIds = [
        ...new Set(Object.values(lineupByUser).flatMap((lps) => lps.map((lp) => lp.player_id))),
      ]

      const [{ data: scores }, { data: players }] =
        allPlayerIds.length > 0
          ? await Promise.all([
              supabase
                .from('player_match_scores')
                .select('player_id, total_score')
                .eq('gameweek_id', gameweek.id)
                .in('player_id', allPlayerIds),
              supabase.from('players').select('id, name').in('id', allPlayerIds),
            ])
          : [{ data: [] }, { data: [] }]

      if (cancelled) return

      const scoreByPlayerId = {}
      ;(scores ?? []).forEach((s) => {
        scoreByPlayerId[s.player_id] = s.total_score
      })
      const nameByPlayerId = {}
      ;(players ?? []).forEach((p) => {
        nameByPlayerId[p.id] = p.name
      })

      const computed = (enrollments ?? []).map((e) => {
        const starters = (lineupByUser[e.user_id] ?? [])
          .slice()
          .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
        const playerRows = starters.map((lp) => ({
          playerId: lp.player_id,
          name: nameByPlayerId[lp.player_id] ?? '?',
          role: lp.slot_role,
          score: scoreByPlayerId[lp.player_id] ?? null,
        }))
        return {
          userId: e.user_id,
          username: e.profiles?.username ?? '—',
          totalScore: playerRows.reduce((sum, p) => sum + (p.score ?? 0), 0),
          players: playerRows,
          rewards: [],
        }
      })

      rankRows(computed)
      setRows(computed)
      setLoading(false)
    }

    function start() {
      setLoading(true)
      if (isFinal) loadFinal()
      else loadLive()
    }
    start()

    return () => {
      cancelled = true
    }
  }, [categoryId, gameweek?.id, isFinal])

  useEffect(() => {
    if (isFinal || Object.keys(scoresMap).length === 0) return

    function patchRows() {
      setRows((prev) => {
        let changed = false
        const patched = prev.map((row) => {
          if (!row.players) return row
          const players = row.players.map((p) => {
            const update = scoresMap[p.playerId]
            if (!update) return p
            changed = true
            return { ...p, score: update.total_score }
          })
          return { ...row, players, totalScore: players.reduce((sum, p) => sum + (p.score ?? 0), 0) }
        })
        if (!changed) return prev
        rankRows(patched)
        return patched
      })
    }

    patchRows()
  }, [scoresMap, isFinal])

  async function toggleExpand(row) {
    if (expandedUserId === row.userId) {
      setExpandedUserId(null)
      return
    }
    setExpandedUserId(row.userId)
    if (row.players) return

    const { data: lineup } = await supabase
      .from('lineups')
      .select('lineup_players(player_id, slot_role, slot_position, slot_type)')
      .eq('user_id', row.userId)
      .eq('category_id', categoryId)
      .eq('gameweek_id', gameweek.id)
      .maybeSingle()

    const starters = (lineup?.lineup_players ?? [])
      .filter((lp) => lp.slot_type === 'starter')
      .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
    const playerIds = starters.map((lp) => lp.player_id)

    const [{ data: players }, { data: scores }] =
      playerIds.length > 0
        ? await Promise.all([
            supabase.from('players').select('id, name').in('id', playerIds),
            supabase
              .from('player_match_scores')
              .select('player_id, total_score')
              .eq('gameweek_id', gameweek.id)
              .in('player_id', playerIds),
          ])
        : [{ data: [] }, { data: [] }]

    const nameByPlayerId = {}
    ;(players ?? []).forEach((p) => {
      nameByPlayerId[p.id] = p.name
    })
    const scoreByPlayerId = {}
    ;(scores ?? []).forEach((s) => {
      scoreByPlayerId[s.player_id] = s.total_score
    })

    setRows((prev) =>
      prev.map((r) =>
        r.userId === row.userId
          ? {
              ...r,
              players: starters.map((lp) => ({
                playerId: lp.player_id,
                name: nameByPlayerId[lp.player_id] ?? '?',
                role: lp.slot_role,
                score: scoreByPlayerId[lp.player_id] ?? null,
              })),
            }
          : r
      )
    )
  }

  if (loading) return <p className="status-text">Caricamento classifica…</p>
  if (rows.length === 0) return <p className="status-text">Nessun iscritto.</p>

  return (
    <>
      <ul className="leaderboard">
      {rows.map((row) => (
        <li key={row.userId} className={'leaderboard-row card' + (row.userId === currentUserId ? ' own' : '')}>
          <button type="button" className="leaderboard-summary" onClick={() => toggleExpand(row)}>
            <span className="leaderboard-rank">{row.rank}°</span>
            <span className="leaderboard-username">{row.username}</span>
            <span className="leaderboard-score">{row.totalScore.toFixed(1)}</span>
          </button>

          {row.rewards?.length > 0 && (
            <div className="leaderboard-rewards">
              {row.rewards.map((r, i) => (
                <span key={i} className="badge-tag">
                  {r.reward_type === 'credits' ? `+${r.reward_value} crediti` : 'giocatore vinto'}
                </span>
              ))}
            </div>
          )}

          {expandedUserId === row.userId && (
            <ul className="leaderboard-detail">
              {(row.players ?? []).map((p) => (
                <li key={p.playerId}>
                  <button type="button" className="leaderboard-detail-player" onClick={() => setSelectedPlayer(p)}>
                    <span className="role-tag">{p.role}</span> {p.name}
                    <span className="leaderboard-detail-score">{p.score != null ? p.score.toFixed(1) : '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
      </ul>

      {selectedPlayer && (
        <PlayerBreakdownModal
          playerId={selectedPlayer.playerId}
          gameweekId={gameweek.id}
          playerName={selectedPlayer.name}
          role={selectedPlayer.role}
          totalScore={selectedPlayer.score}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </>
  )
}

function rankRows(rows) {
  rows.sort((a, b) => b.totalScore - a.totalScore)
  let rank = 0
  let prevScore = null
  rows.forEach((row, idx) => {
    if (prevScore === null || row.totalScore !== prevScore) rank = idx + 1
    prevScore = row.totalScore
    row.rank = rank
  })
}
