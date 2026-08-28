import { useState } from 'react'
import { BREAKDOWN_ICONS, BREAKDOWN_LABELS, getIconColor } from '../lib/breakdownIcons'
import PlayerBreakdownModal from './PlayerBreakdownModal'
import './LeagueFormationDetail.css'

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

function ActionIcons({ breakdown, isReverse }) {
  const entries = Object.entries(breakdown ?? {}).filter(([key, value]) => value !== 0 && BREAKDOWN_ICONS[key])
  if (entries.length === 0) return null

  return (
    <span className="formation-action-icons">
      {entries.map(([key, value]) => {
        const iconDef = BREAKDOWN_ICONS[key]
        const Icon = iconDef.icon
        const color = getIconColor(key, value, isReverse)
        return (
          <span key={key} className="formation-action-icon" title={BREAKDOWN_LABELS[key] ?? key}>
            <Icon size={13} color={color} fill={iconDef.fill ?? 'none'} style={{ color }} />
          </span>
        )
      })}
    </span>
  )
}

// One starter "slot": the module position that was nominally filled by
// `slot.originalPlayerName`. Always shows whoever actually CONTRIBUTED to
// the score first (the original starter if they played, otherwise
// whichever bench player was auto-subbed in for them) — with a small note
// underneath explaining the substitution when one happened, or that the
// slot went unfilled if no valid sub was on the bench.
function StarterSlot({ slot, isReverse, onOpenPlayer }) {
  const contributorName = slot.subApplied ? slot.effectivePlayerName : slot.originalPlayerName
  const contributorRole = slot.subApplied ? slot.effectiveRole : slot.slotRole
  const contributorId = slot.subApplied ? slot.effectivePlayerId : slot.originalPlayerId

  return (
    <li className="formation-slot">
      <div className="formation-slot-row">
        <span className="role-tag">{contributorRole}</span>
        <button
          type="button"
          className="formation-player-name"
          onClick={() =>
            onOpenPlayer({
              playerId: contributorId,
              playerName: contributorName,
              role: contributorRole,
              totalScore: slot.score,
              breakdown: slot.breakdown,
            })
          }
        >
          {contributorName ?? '—'}
        </button>
        {slot.isEmpty ? (
          <span className="formation-status-badge formation-status-empty">Assente</span>
        ) : (
          <>
            <span className={'formation-score ' + scoreClass(slot.score)}>{(slot.score ?? 0).toFixed(1)}</span>
            <ActionIcons breakdown={slot.breakdown} isReverse={isReverse} />
          </>
        )}
      </div>

      {slot.subApplied && (
        <div className="formation-slot-note">
          ↳ al posto di <strong>{slot.originalPlayerName}</strong> (non ha giocato)
        </div>
      )}
      {slot.isEmpty && (
        <div className="formation-slot-note">
          <strong>{slot.originalPlayerName}</strong> non ha giocato — nessun sostituto disponibile in panchina
        </div>
      )}
    </li>
  )
}

function BenchRow({ player }) {
  return (
    <li className={'formation-bench-row' + (player.usedAsSub ? ' formation-bench-used' : '')}>
      <span className="formation-bench-order">{player.order}</span>
      <span className="formation-bench-name">{player.playerName}</span>
      {player.usedAsSub && <span className="formation-status-badge formation-status-subbed">Entrato</span>}
      {!player.usedAsSub && player.played && (
        <span className="formation-status-badge formation-status-played">Ha giocato</span>
      )}
    </li>
  )
}

// Renders one member's full GW formation: starters (with score, bonus/
// malus action icons, and automatic-substitution state) plus the bench in
// order. `formation` is the shape built by LeagueGameweekPanel's
// toggleFormation() — see that file for the data-fetching side.
export default function LeagueFormationDetail({ formation, isReverse }) {
  const [openPlayer, setOpenPlayer] = useState(null)

  if (!formation) return <p className="status-text">Caricamento…</p>
  if (formation.starters.length === 0) return <p className="status-text">Nessuna formazione schierata.</p>

  return (
    <div className="formation-detail">
      <div className="formation-detail-header">
        <span className="formation-module">{formation.moduleId}</span>
        <span className={'formation-total ' + scoreClass(formation.totalScore)}>
          {formation.totalScore.toFixed(1)}
        </span>
      </div>

      <ul className="formation-slot-list">
        {formation.starters.map((slot) => (
          <StarterSlot key={slot.slotPosition} slot={slot} isReverse={isReverse} onOpenPlayer={setOpenPlayer} />
        ))}
      </ul>

      {formation.bench.length > 0 && (
        <div className="formation-bench">
          <h4>Panchina</h4>
          <ul className="formation-bench-list">
            {formation.bench.map((player) => (
              <BenchRow key={player.playerId} player={player} />
            ))}
          </ul>
        </div>
      )}

      {openPlayer && (
        <PlayerBreakdownModal
          playerId={openPlayer.playerId}
          playerName={openPlayer.playerName}
          role={openPlayer.role}
          totalScore={openPlayer.totalScore}
          breakdown={openPlayer.breakdown}
          isReverse={isReverse}
          onClose={() => setOpenPlayer(null)}
        />
      )}
    </div>
  )
}
