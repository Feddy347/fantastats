// The 7 traditional Classic modules for 11-a-side leagues with
// role_system='classic'. Classic roles are single-valued (players.role_classic
// is exactly one of P/D/C/A, no multi-role like Fantastats/Mantra), so each
// slot only ever accepts one role.

function line(role, count) {
  return Array.from({ length: count }, () => ({ roles: [role] }))
}

function buildModule(id, def, mid, fwd) {
  return {
    id,
    label: id,
    slots: [{ roles: ['P'] }, ...line('D', def), ...line('C', mid), ...line('A', fwd)],
  }
}

export const CLASSIC_MODULES = [
  buildModule('3-4-3', 3, 4, 3),
  buildModule('3-5-2', 3, 5, 2),
  buildModule('4-3-3', 4, 3, 3),
  buildModule('4-4-2', 4, 4, 2),
  buildModule('4-5-1', 4, 5, 1),
  buildModule('5-3-2', 5, 3, 2),
  buildModule('5-4-1', 5, 4, 1),
]

export const DEFAULT_CLASSIC_MODULE_ID = CLASSIC_MODULES[0].id

export function getClassicModule(moduleId) {
  return CLASSIC_MODULES.find((m) => m.id === moduleId) ?? CLASSIC_MODULES[0]
}

export function classicPlayerRole(player) {
  return player.role_classic ?? null
}
