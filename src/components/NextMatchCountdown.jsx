import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
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

export default function NextMatchCountdown() {
  const [nextMatchDate, setNextMatchDate] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('serie_a_fixtures')
        .select('match_date')
        .neq('status', 'finished')
        .not('match_date', 'is', null)
        .gte('match_date', new Date().toISOString())
        .order('match_date', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!cancelled) setNextMatchDate(data?.match_date ?? null)
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

  if (!nextMatchDate) return null

  const parts = timeParts(new Date(nextMatchDate).getTime(), now)
  if (!parts) return null

  return (
    <div className="next-match-countdown">
      <div className="next-match-countdown-header">
        <span className="next-match-countdown-icon">
          <Timer size={18} strokeWidth={2.5} />
        </span>
        <span className="next-match-countdown-label">Prossima gameweek in</span>
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
