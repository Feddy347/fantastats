import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { abbreviatePlayerName } from '../lib/format'
import GameweekLeaderboard from './GameweekLeaderboard'
import './LiveTileDetail.css'

const BREAKDOWN_LABELS = {
  participation: 'Partecipazione',
  goals: 'Gol',
  penaltyGoals: 'Gol su rigore',
  assists: 'Assist',
  shotsOnTarget: 'Tiri in porta',
  bigChances: 'Big chance create',
  penaltyWon: 'Rigore procurato',
  penaltyMissed: 'Rigore sbagliato',
  passing: 'Passaggi riusciti',
  tackles: 'Tackle vinti',
  interceptions: 'Intercetti',
  clearances: 'Respinte',
  duels: 'Duelli vinti',
  lineClearance: 'Salvataggio sulla linea',
  lastManTackle: 'Intervento da ultimo uomo',
  keeperSaves: 'Parate',
  penaltySave: 'Rigore parato',
  goalsConceded: 'Gol subiti',
  discipline: 'Disciplina/errori',
  cleanSheetBonus: 'Bonus clean sheet',
  passAccuracyBonus: 'Bonus precisione passaggi',
  dribbleBonus: 'Bonus dribbling',
  bigChanceBonus: 'Bonus big chance',
  goalkeeperMalus: 'Malus gol subiti',
  foulsMalus: 'Malus falli',
  noTacklesMalus: 'Malus 0 tackle',
}

// Read-only pitch: tile.players is already ordered POR -> DEF x3 -> OFF x3
// (same convention as the Lineup page / MODULES slot layout).
function pitchRows(players) {
  return {
    offense: players.slice(4, 7),
    defense: players.slice(1, 4),
    keeper: players.slice(0, 1),
  }
}

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

export default function LiveTileDetail({ tile, gameweek, userId, onClose }) {
  const [breakdownByPlayerId, setBreakdownByPlayerId] = useState({})
  const [expandedPlayerId, setExpandedPlayerId] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const playerIds = tile.players.map((p) => p.player_id)
      if (playerIds.length === 0) return
      const { data } = await supabase
        .from('player_match_scores')
        .select('player_id, score_breakdown')
        .eq('gameweek_id', gameweek.id)
        .in('player_id', playerIds)

      if (cancelled || !data) return
      const map = {}
      data.forEach((row) => {
        map[row.player_id] = row.score_breakdown
      })
      setBreakdownByPlayerId(map)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tile.players, gameweek.id])

  const { offense, defense, keeper } = pitchRows(tile.players)

  function renderPlayer(p) {
    const breakdown = breakdownByPlayerId[p.player_id]
    const isExpanded = expandedPlayerId === p.player_id
    return (
      <div key={p.player_id} className="detail-slot-wrap">
        <button
          type="button"
          className="detail-slot"
          onClick={() => setExpandedPlayerId(isExpanded ? null : p.player_id)}
        >
          <span className="slot-role">{p.role}</span>
          <span className="slot-player-name">{abbreviatePlayerName(p.name)}</span>
          <span className={'slot-score ' + scoreClass(p.score)}>{p.score != null ? p.score.toFixed(1) : '—'}</span>
        </button>
        {isExpanded && breakdown && (
          <ul className="breakdown-list">
            {Object.entries(breakdown)
              .filter(([, v]) => v !== 0)
              .map(([key, value]) => (
                <li key={key}>
                  <span>{BREAKDOWN_LABELS[key] ?? key}</span>
                  <span className={value > 0 ? 'positive' : 'negative'}>{value > 0 ? `+${value}` : value}</span>
                </li>
              ))}
            {Object.values(breakdown).every((v) => v === 0) && <li className="status-text">Nessuna azione ancora.</li>}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail-panel card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header">
          <h2>{tile.category_name}</h2>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </div>

        <div className="detail-pitch">
          <div className="pitch-row offense">{offense.map(renderPlayer)}</div>
          <div className="pitch-row defense">{defense.map(renderPlayer)}</div>
          <div className="pitch-row keeper">{keeper.map(renderPlayer)}</div>
        </div>

        <section>
          <h3>Classifica {tile.category_name}</h3>
          <GameweekLeaderboard categoryId={tile.category_id} gameweek={gameweek} currentUserId={userId} />
        </section>
      </div>
    </div>
  )
}
