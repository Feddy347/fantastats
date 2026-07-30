import {
  Target,
  Crosshair,
  Hand,
  ShieldCheck,
  Flame,
  Sparkles,
  Compass,
  Shield,
  Zap,
  Footprints,
  Square,
  Skull,
  XCircle,
  AlertTriangle,
  AlertCircle,
  X,
  ArrowDownCircle,
} from 'lucide-react'

// Maps a scoreEngine breakdown key to the Lucide icon + color used in the
// live/breakdown views, per the design brief's action->icon table. Keys not
// listed here (participation, passing, plain tackles/interceptions/etc.)
// render as plain text — the brief only calls out the "highlight" actions.
export const BREAKDOWN_ICONS = {
  goals: { icon: Target, color: 'var(--success)' },
  penaltyGoals: { icon: Target, color: 'var(--success)' },
  assists: { icon: Crosshair, color: 'var(--success)' },
  keeperSaves: { icon: Hand, color: 'var(--secondary)' },
  penaltySave: { icon: Hand, color: 'var(--secondary)' },
  cleanSheetBonus: { icon: ShieldCheck, color: 'var(--success)' },
  dribbleBonus: { icon: Flame, color: 'var(--warning)' },
  bigChanceBonus: { icon: Sparkles, color: 'var(--warning)' },
  passAccuracyBonus: { icon: Compass, color: 'var(--secondary)' },
  lineClearance: { icon: Shield, color: 'var(--success)' },
  lastManTackle: { icon: Zap, color: 'var(--success)' },
  penaltyWon: { icon: Footprints, color: 'var(--success)' },
  yellowCard: { icon: Square, color: '#ffd700', fill: '#ffd700' },
  redCard: { icon: Square, color: 'var(--danger)', fill: 'var(--danger)' },
  ownGoals: { icon: Skull, color: 'var(--danger)' },
  errorLeadToGoal: { icon: XCircle, color: 'var(--danger)' },
  errorLeadToShot: { icon: XCircle, color: 'var(--danger)' },
  penaltyConceded: { icon: AlertTriangle, color: 'var(--danger)' },
  foulsMalus: { icon: AlertCircle, color: 'var(--danger)' },
  penaltyMissed: { icon: X, color: 'var(--danger)' },
  goalsConceded: { icon: ArrowDownCircle, color: 'var(--danger)' },
  goalkeeperMalus: { icon: ArrowDownCircle, color: 'var(--danger)' },
}
