import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { BREAKDOWN_ICONS, BREAKDOWN_LABELS } from '../lib/breakdownIcons'
import './PlayerBreakdownModal.css'

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

function BreakdownList({ breakdown }) {
  const entries = Object.entries(breakdown ?? {}).filter(([, v]) => v !== 0)

  if (entries.length === 0) {
    return <p className="status-text">Nessuna azione ancora.</p>
  }

  return (
    <ul className="breakdown-list">
      {entries.map(([key, value]) => {
        const iconDef = BREAKDOWN_ICONS[key]
        const Icon = iconDef?.icon
        return (
          <li key={key}>
            <span className="breakdown-label">
              {Icon && (
                <Icon
                  className="breakdown-icon icon-flash-in"
                  size={14}
                  color={iconDef.color}
                  fill={iconDef.fill ?? 'none'}
                  style={{ color: iconDef.color }}
                />
              )}
              {BREAKDOWN_LABELS[key] ?? key}
            </span>
            <span className={value > 0 ? 'positive' : 'negative'}>{value > 0 ? `+${value}` : value}</span>
          </li>
        )
      })}
    </ul>
  )
}

// Two ways to use this:
//   - pass playerId + gameweekId: fetches score_breakdown from
//     player_match_scores (categories context, already computed at poll time)
//   - pass breakdown directly: for contexts (leagues) where the score had
//     to be computed fresh client-side, since a league lineup can field a
//     player in a different slot/role than any category lineup — see
//     src/lib/leagueScoring.js's header comment.
export default function PlayerBreakdownModal({
  playerId,
  gameweekId,
  playerName,
  role,
  totalScore,
  breakdown: providedBreakdown,
  onClose,
}) {
  const [fetchedBreakdown, setFetchedBreakdown] = useState(null)
  const [loading, setLoading] = useState(providedBreakdown === undefined && playerId != null)

  useEffect(() => {
    if (providedBreakdown !== undefined || playerId == null) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('player_match_scores')
        .select('score_breakdown, total_score')
        .eq('player_id', playerId)
        .eq('gameweek_id', gameweekId)
        .maybeSingle()
      if (!cancelled) {
        setFetchedBreakdown(data?.score_breakdown ?? {})
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [playerId, gameweekId, providedBreakdown])

  const breakdown = providedBreakdown ?? fetchedBreakdown

  return (
    <div
      className="confirm-backdrop"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="breakdown-modal-panel card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <div>
            <h2>{playerName}</h2>
            {role && <span className="role-tag">{role}</span>}
          </div>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </div>

        {totalScore != null && (
          <div className={'breakdown-total ' + scoreClass(totalScore)}>{totalScore.toFixed(1)}</div>
        )}

        {loading ? <p className="status-text">Caricamento…</p> : <BreakdownList breakdown={breakdown} />}
      </div>
    </div>
  )
}
