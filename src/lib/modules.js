// The 8 formation modules a lineup can use. Slot 0 is always the goalkeeper,
// slots 1-3 the defensive line, slots 4-6 the offensive line — matching the
// `module` check constraint in supabase/migrations/20260730000000_lineups.sql.

export const MODULES = [
  { id: 'DC+DC+C|ES+Tq+ATT', label: 'Classico equilibrato', slots: ['POR', 'DC', 'DC', 'C', 'ES', 'Tq', 'ATT'] },
  { id: 'DC+DC+C|ES+ES+ATT', label: 'Doppio esterno', slots: ['POR', 'DC', 'DC', 'C', 'ES', 'ES', 'ATT'] },
  { id: 'DC+DC+C|ES+ATT+ATT', label: 'Doppia punta, una fascia', slots: ['POR', 'DC', 'DC', 'C', 'ES', 'ATT', 'ATT'] },
  { id: 'DC+DC+C|Tq+ATT+ATT', label: 'Doppia punta centrale', slots: ['POR', 'DC', 'DC', 'C', 'Tq', 'ATT', 'ATT'] },
  { id: 'DC+T+C|ES+Tq+ATT', label: 'Con terzino', slots: ['POR', 'DC', 'T', 'C', 'ES', 'Tq', 'ATT'] },
  { id: 'DC+T+C|ES+ES+ATT', label: 'Terzino + doppie fasce', slots: ['POR', 'DC', 'T', 'C', 'ES', 'ES', 'ATT'] },
  { id: 'DC+T+C|ES+ATT+ATT', label: 'Terzino + doppia punta', slots: ['POR', 'DC', 'T', 'C', 'ES', 'ATT', 'ATT'] },
  { id: 'T+T+C|ES+Tq+ATT', label: 'Senza centrali', slots: ['POR', 'T', 'T', 'C', 'ES', 'Tq', 'ATT'] },
]

export const DEFAULT_MODULE_ID = MODULES[0].id

export function getModule(moduleId) {
  return MODULES.find((m) => m.id === moduleId) ?? MODULES[0]
}

export function playerRoles(player) {
  return (player.role_fantastats ?? '')
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
}

export function playerHasRole(player, role) {
  return playerRoles(player).includes(role)
}
