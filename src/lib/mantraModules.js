// The 11 Mantra modules used by 11-a-side leagues with role_system='mantra'.
// Slot 0 is always the goalkeeper (Por); slots 1-5 are the "difensivo" bucket
// and 6-10 the "offensivo" bucket — mirrors the Fantastats module shape
// (POR, then defense block, then offense block), just scaled to 5+5.
//
// Each slot lists the Mantra roles (from players.role_mantra, semicolon
// separated, e.g. "Dd;E") that may fill it. A few formations (4-4-2,
// 4-4-1-1, 4-2-3-1) split an identically-labelled pair of slots across the
// defense/offense buckets — harmless since both slots in the pair accept
// the exact same roles, so eligibility is unaffected; only the (future)
// scoring multiplier bucket differs.

function slot(roles) {
  return { roles }
}

export const MANTRA_MODULES = [
  {
    id: '3-4-3',
    label: '3-4-3',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dc']), slot(['E', 'M']), slot(['E', 'M']),
      slot(['C', 'W']), slot(['C', 'W']), slot(['T', 'A']), slot(['A', 'Pc']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '3-4-1-2',
    label: '3-4-1-2',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dc']), slot(['E', 'M']), slot(['E', 'M']),
      slot(['C']), slot(['C']), slot(['T']), slot(['A', 'Pc']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '3-4-2-1',
    label: '3-4-2-1',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dc']), slot(['E', 'M']), slot(['E', 'M']),
      slot(['C']), slot(['C']), slot(['T', 'W']), slot(['T', 'W']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '3-5-2',
    label: '3-5-2',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dc']), slot(['E', 'M']), slot(['E', 'M']),
      slot(['M', 'C']), slot(['M', 'C']), slot(['C', 'T']), slot(['A', 'Pc']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '3-5-1-1',
    label: '3-5-1-1',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dc']), slot(['E', 'M']), slot(['E', 'M']),
      slot(['M', 'C']), slot(['M', 'C']), slot(['C']), slot(['T']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '4-3-3',
    label: '4-3-3',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dd', 'Ds']), slot(['Dd', 'Ds']), slot(['M']),
      slot(['C']), slot(['C']), slot(['W']), slot(['W']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '4-3-1-2',
    label: '4-3-1-2',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dd', 'Ds']), slot(['Dd', 'Ds']), slot(['M']),
      slot(['C']), slot(['C']), slot(['T']), slot(['A', 'Pc']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '4-4-2',
    label: '4-4-2',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dd', 'Ds']), slot(['Dd', 'Ds']), slot(['E', 'M']),
      slot(['E', 'M']), slot(['C', 'W']), slot(['C', 'W']), slot(['A', 'Pc']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '4-1-4-1',
    label: '4-1-4-1',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dd', 'Ds']), slot(['Dd', 'Ds']), slot(['M']),
      slot(['C', 'W']), slot(['C', 'W']), slot(['W', 'T']), slot(['W', 'T']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '4-4-1-1',
    label: '4-4-1-1',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dd', 'Ds']), slot(['Dd', 'Ds']), slot(['E', 'M']),
      slot(['E', 'M']), slot(['C', 'W']), slot(['C', 'W']), slot(['T']), slot(['A', 'Pc']),
    ],
  },
  {
    id: '4-2-3-1',
    label: '4-2-3-1',
    slots: [
      slot(['Por']),
      slot(['Dc']), slot(['Dc']), slot(['Dd', 'Ds']), slot(['Dd', 'Ds']), slot(['M', 'C']),
      slot(['M', 'C']), slot(['W', 'T']), slot(['W', 'T']), slot(['T', 'C']), slot(['A', 'Pc']),
    ],
  },
]

export const DEFAULT_MANTRA_MODULE_ID = MANTRA_MODULES[0].id

export function getMantraModule(moduleId) {
  return MANTRA_MODULES.find((m) => m.id === moduleId) ?? MANTRA_MODULES[0]
}

export function mantraPlayerRoles(player) {
  return (player.role_mantra ?? '')
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
}

export function mantraPlayerHasRole(player, role) {
  return mantraPlayerRoles(player).includes(role)
}
