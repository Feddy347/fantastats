import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Subscribes to player_match_scores changes for a gameweek and returns them
// grouped by player_id. Consumers merge this into their own view of a
// lineup; this hook doesn't know about categories, lineups or ranking.
export function useRealtimeScores(gameweekId) {
  const [scoresByPlayerId, setScoresByPlayerId] = useState({})

  useEffect(() => {
    let cancelled = false

    async function loadInitial() {
      if (!gameweekId) {
        setScoresByPlayerId({})
        return
      }

      const { data } = await supabase
        .from('player_match_scores')
        .select('player_id, total_score, is_final, updated_at')
        .eq('gameweek_id', gameweekId)

      if (cancelled || !data) return

      const map = {}
      data.forEach((row) => {
        map[row.player_id] = row
      })
      setScoresByPlayerId(map)
    }

    loadInitial()

    if (!gameweekId) return

    const channel = supabase
      .channel(`player-match-scores-gw-${gameweekId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'player_match_scores',
          filter: `gameweek_id=eq.${gameweekId}`,
        },
        (payload) => {
          const row = payload.new
          if (!row) return
          setScoresByPlayerId((prev) => ({ ...prev, [row.player_id]: row }))
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [gameweekId])

  return scoresByPlayerId
}
