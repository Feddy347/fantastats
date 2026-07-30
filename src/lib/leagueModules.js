// Unifies the 3 possible league formation systems behind one interface so
// the league lineup builder doesn't need three separate code paths.
//   - formation_type '7'          -> Fantastats system (8 modules, 7 starters)
//   - formation_type '11' + mantra -> Mantra system (11 modules, 11 starters)
//   - formation_type '11' + classic -> Classic system (7 modules, 11 starters)

import { MODULES as FANTASTATS_MODULES, DEFAULT_MODULE_ID as FANTASTATS_DEFAULT_ID } from './modules'
import { MANTRA_MODULES, DEFAULT_MANTRA_MODULE_ID } from './mantraModules'
import { CLASSIC_MODULES, DEFAULT_CLASSIC_MODULE_ID } from './classicModules'

function normalizeFantastatsModules() {
  return FANTASTATS_MODULES.map((m) => ({
    id: m.id,
    label: m.label,
    slots: m.slots.map((role) => ({ roles: [role] })),
  }))
}

export function getLeagueModuleSystem(league) {
  if (league.formation_type === '7') {
    return {
      starterCount: 7,
      modules: normalizeFantastatsModules(),
      defaultModuleId: FANTASTATS_DEFAULT_ID,
      roleField: 'role_fantastats',
    }
  }

  if (league.role_system === 'mantra') {
    return {
      starterCount: 11,
      modules: MANTRA_MODULES,
      defaultModuleId: DEFAULT_MANTRA_MODULE_ID,
      roleField: 'role_mantra',
    }
  }

  return {
    starterCount: 11,
    modules: CLASSIC_MODULES,
    defaultModuleId: DEFAULT_CLASSIC_MODULE_ID,
    roleField: 'role_classic',
  }
}

export function getLeagueModule(system, moduleId) {
  return system.modules.find((m) => m.id === moduleId) ?? system.modules[0]
}

export function playerRolesFor(player, roleField) {
  const raw = player?.[roleField]
  if (!raw) return []
  return String(raw)
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
}

export function playerHasRoleFor(player, roleField, role) {
  return playerRolesFor(player, roleField).includes(role)
}

export function playerFitsSlot(player, roleField, slotRoles) {
  return slotRoles.some((r) => playerHasRoleFor(player, roleField, r))
}

// Which specific role (among the slot's acceptable roles) this player
// actually covers — matters for a future scoring multiplier that depends on
// the exact role played, not just "which slot they filled."
export function resolveSlotRole(player, roleField, slotRoles) {
  return slotRoles.find((r) => playerHasRoleFor(player, roleField, r)) ?? slotRoles[0]
}
