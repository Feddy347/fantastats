import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import GameweekLeaderboard from './GameweekLeaderboard'
import PitchField from './PitchField'
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

  const pitchSlots = tile.players.map((p) => ({
    role: p.role,
    label: p.role,
    player: { name: p.name },
    score: p.score,
    isLive: p.is_live,
    onClick: () => setExpandedPlayerId(expandedPlayerId === p.player_id ? null : p.player_id),
  }))

  const expandedPlayer = tile.players.find((p) => p.player_id === expandedPlayerId)
  const expandedBreakdown = expandedPlayerId != null ? breakdownByPlayerId[expandedPlayerId] : null

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail-panel card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header">
          <h2>{tile.category_name}</h2>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </div>

        <PitchField system="fantastats" slots={pitchSlots} />

        {expandedPlayer && (
          <div className="breakdown-panel">
            <h3>{expandedPlayer.name}</h3>
            {expandedBreakdown && Object.values(expandedBreakdown).some((v) => v !== 0) ? (
              <ul className="breakdown-list">
                {Object.entries(expandedBreakdown)
                  .filter(([, v]) => v !== 0)
                  .map(([key, value]) => (
                    <li key={key}>
                      <span>{BREAKDOWN_LABELS[key] ?? key}</span>
                      <span className={value > 0 ? 'positive' : 'negative'}>{value > 0 ? `+${value}` : value}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="status-text">Nessuna azione ancora.</p>
            )}
          </div>
        )}

        <section>
          <h3>Classifica {tile.category_name}</h3>
          <GameweekLeaderboard categoryId={tile.category_id} gameweek={gameweek} currentUserId={userId} />
        </section>
      </div>
    </div>
  )
}
