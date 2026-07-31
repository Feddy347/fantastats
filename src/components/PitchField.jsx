import { computePitchPositions } from '../lib/pitchLayout'
import { surnameOnly, initials } from '../lib/format'
import './PitchField.css'

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

// Realistic pitch background (grass stripes, boxes, centre circle — plain
// bordered divs, not SVG) plus absolutely-positioned player chips. `slots`
// is an array (length = starterCount) of { role, label, player, locked,
// onClick, score, isLive }. `role` drives layout (must be one of the
// system's atomic role codes); `label` is what's printed under the chip
// (may differ, e.g. "ES/M").
export default function PitchField({ system, slots, readOnly = false }) {
  const positions = computePitchPositions(
    system,
    slots.map((s) => s.role)
  )

  return (
    <div className="pitch-field">
      <div className="pitch-stripes" aria-hidden="true">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="pitch-stripe" />
        ))}
      </div>

      <div className="pitch-markings" aria-hidden="true">
        <div className="pitch-center-line" />
        <div className="pitch-center-circle" />
        <div className="pitch-center-spot" />
        <div className="pitch-box-top" />
        <div className="pitch-small-box-top" />
        <div className="pitch-spot-top" />
        <div className="pitch-box-bottom" />
        <div className="pitch-small-box-bottom" />
        <div className="pitch-spot-bottom" />
      </div>

      {slots.map((slot, idx) => {
        const pos = positions[idx]
        const filled = Boolean(slot.player)
        return (
          <div key={idx} className="player-chip" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
            {filled ? (
              <button
                type="button"
                className="player-chip-fill"
                disabled={readOnly || slot.locked}
                onClick={slot.onClick}
              >
                <span className="player-chip-avatar">
                  {slot.isLive && <span className="live-dot player-chip-dot" aria-label="In corso" />}
                  {initials(slot.player.name)}
                </span>
                <span className="player-chip-name">{surnameOnly(slot.player.name)}</span>
                <span className="player-chip-role">{slot.label ?? slot.role}</span>
                {slot.score != null && (
                  <span className={'player-chip-score ' + scoreClass(slot.score)}>{slot.score.toFixed(1)}</span>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="player-chip-empty"
                disabled={readOnly || slot.locked}
                onClick={slot.onClick}
                aria-label={`Assegna ${slot.label ?? slot.role}`}
              >
                <span className="player-chip-avatar player-chip-avatar-empty">+</span>
                <span className="player-chip-role">{slot.label ?? slot.role}</span>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
