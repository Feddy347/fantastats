import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { getCurrentGameweek } from '../lib/gameweek'
import './NextMatchCountdown.css'

function timeParts(targetMs, nowMs) {
  const diff = targetMs - nowMs
  if (diff <= 0) return null
  const totalMinutes = Math.floor(diff / 60000)
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor((totalMinutes % (24 * 60)) / 60),
    minutes: totalMinutes % 60,
  }
}

// Counts down to the CURRENT fantasy gameweek's own lineup deadline (the
// same `gameweeks` row and `deadline` field isLineupLocked() checks
// against — see src/lib/gameweek.js), not the next real Serie A kickoff
// from serie_a_fixtures like this used to (AUDIT_REPORT.md §9.1). Those
// two calendars can drift apart — nothing currently advances
// gameweeks.status automatically, so gameweeks can sit well past their
// deadline while serie_a_fixtures keeps ticking along on the real
// calendar — and showing a real-match countdown under a "prossima
// gameweek" label was misleading about how much time was actually left to
// set a lineup.
export default function NextMatchCountdown() {
  const [deadline, setDeadline] = useState(null)
  const [gwNumber, setGwNumber] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false

    async function load() {
      const gw = await getCurrentGameweek()
      if (cancelled) return
      setGwNumber(gw?.number ?? null)
      setDeadline(gw?.deadline ?? gw?.starts_at ?? null)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  if (!deadline) return null

  const parts = timeParts(new Date(deadline).getTime(), now)
  if (!parts) return null

  return (
    <div className="next-match-countdown">
      <div className="next-match-countdown-header">
        <span className="next-match-countdown-icon">
          <Timer size={18} strokeWidth={2.5} />
        </span>
        <span className="next-match-countdown-label">Giornata {gwNumber} — chiusura formazioni tra</span>
      </div>

      <div className="next-match-countdown-digits">
        <div className="next-match-countdown-unit">
          <span className="next-match-countdown-number">{parts.days}</span>
          <span className="next-match-countdown-unit-label">giorni</span>
        </div>
        <span className="next-match-countdown-sep">:</span>
        <div className="next-match-countdown-unit">
          <span className="next-match-countdown-number">{String(parts.hours).padStart(2, '0')}</span>
          <span className="next-match-countdown-unit-label">ore</span>
        </div>
        <span className="next-match-countdown-sep">:</span>
        <div className="next-match-countdown-unit">
          <span className="next-match-countdown-number">{String(parts.minutes).padStart(2, '0')}</span>
          <span className="next-match-countdown-unit-label">minuti</span>
        </div>
      </div>
    </div>
  )
}
