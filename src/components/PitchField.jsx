import { computePitchPositions } from '../lib/pitchLayout'
import { surnameOnly } from '../lib/format'
import './PitchField.css'

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

// Realistic pitch background (lines, centre circle, penalty boxes) plus
// absolutely-positioned player chips. `slots` is an array (length =
// starterCount) of { role, label, player, locked, onClick, score, isLive }.
// `role` drives layout (must be one of the system's atomic role codes);
// `label` is what's printed under the chip (may differ, e.g. "ES/M").
export default function PitchField({ system, slots, readOnly = false }) {
  const positions = computePitchPositions(
    system,
    slots.map((s) => s.role)
  )

  return (
    <div className="pitch-field">
      <svg className="pitch-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="2" y="2" width="96" height="96" rx="2" vectorEffect="non-scaling-stroke" />
        <line x1="2" y1="50" x2="98" y2="50" vectorEffect="non-scaling-stroke" />
        <circle cx="50" cy="50" r="15" vectorEffect="non-scaling-stroke" />
        <circle cx="50" cy="50" r="0.8" fill="white" stroke="none" />
        <rect x="25" y="2" width="50" height="16" vectorEffect="non-scaling-stroke" />
        <rect x="38" y="2" width="24" height="6" vectorEffect="non-scaling-stroke" />
        <circle cx="50" cy="13" r="0.8" fill="white" stroke="none" />
        <rect x="25" y="82" width="50" height="16" vectorEffect="non-scaling-stroke" />
        <rect x="38" y="92" width="24" height="6" vectorEffect="non-scaling-stroke" />
        <circle cx="50" cy="87" r="0.8" fill="white" stroke="none" />
      </svg>

      {slots.map((slot, idx) => {
        const pos = positions[idx]
        const filled = Boolean(slot.player)
        return (
          <div key={idx} className="pitch-chip" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
            {filled ? (
              <button
                type="button"
                className="pitch-chip-fill"
                disabled={readOnly || slot.locked}
                onClick={slot.onClick}
              >
                {slot.isLive && <span className="live-dot pitch-chip-dot" aria-label="In corso" />}
                <span className="pitch-chip-name">{surnameOnly(slot.player.name)}</span>
                <span className="pitch-chip-role">{slot.label ?? slot.role}</span>
                {slot.score != null && (
                  <span className={'pitch-chip-score ' + scoreClass(slot.score)}>{slot.score.toFixed(1)}</span>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="pitch-chip-empty"
                disabled={readOnly || slot.locked}
                onClick={slot.onClick}
                aria-label={`Assegna ${slot.label ?? slot.role}`}
              >
                <span>+</span>
                <span className="pitch-chip-role">{slot.label ?? slot.role}</span>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
