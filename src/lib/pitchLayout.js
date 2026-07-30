// Computes realistic-ish (x%, y%) pitch coordinates for a formation's
// slots, given the system (fantastats/mantra/classic) and the role each
// slot nominally represents. Positioning is purely visual — it's derived
// once from the module's own slot roles, not from whichever player ends up
// assigned to a slot, so chips don't jump around as a lineup is built.
//
// Coordinate space: x 0-100 (0=left touchline, 100=right touchline),
// y 0-100 (0=opponent's goal line at the top, 100=own goal line at the
// bottom — goalkeeper near the bottom, attackers near the top).
//
// Each role has a "line" (which horizontal band it belongs to) and a
// "width" preference (-1 left touchline .. 0 centre .. 1 right touchline).
// A small depthOffset nudges a role slightly forward/back within its line
// (e.g. a Fantastats "C" sits a touch higher than the DC pair beside it).
// Roles sharing both a line and a depthOffset are treated as one visual
// row and spread out from the centre (mirrored for inherently wide roles
// so two wing-backs land on opposite flanks, not stacked on one side).

const ROLE_META = {
  fantastats: {
    POR: { line: 0, width: 0 },
    DC: { line: 1, width: 0 },
    T: { line: 1, width: 0.75 },
    C: { line: 1, width: 0, depthOffset: 10 },
    ES: { line: 2, width: 0.8 },
    Tq: { line: 2, width: 0 },
    ATT: { line: 2, width: 0, depthOffset: 8 },
  },
  mantra: {
    Por: { line: 0, width: 0 },
    Dc: { line: 1, width: 0 },
    Dd: { line: 1, width: 0.75 },
    Ds: { line: 1, width: -0.75 },
    B: { line: 1, width: 0.4 },
    E: { line: 2, width: 0.85 },
    M: { line: 2, width: 0, depthOffset: -6 },
    C: { line: 2, width: 0, depthOffset: 6 },
    W: { line: 2, width: 0.85, depthOffset: 8 },
    T: { line: 2, width: 0, depthOffset: 14 },
    A: { line: 3, width: 0 },
    Pc: { line: 3, width: 0 },
  },
  classic: {
    P: { line: 0, width: 0 },
    D: { line: 1, width: 0 },
    C: { line: 2, width: 0 },
    A: { line: 3, width: 0 },
  },
}

const LINE_Y = {
  fantastats: [90, 62, 22],
  mantra: [90, 68, 42, 16],
  classic: [90, 68, 42, 16],
}

const WIDE_THRESHOLD = 0.3

export function computePitchPositions(system, roles) {
  const table = ROLE_META[system] ?? ROLE_META.fantastats
  const lineYs = LINE_Y[system] ?? LINE_Y.fantastats

  const items = roles.map((role, index) => {
    const meta = table[role] ?? { line: 1, width: 0 }
    return { index, role, line: meta.line, width: meta.width, depthOffset: meta.depthOffset ?? 0 }
  })

  const byLine = new Map()
  items.forEach((item) => {
    if (!byLine.has(item.line)) byLine.set(item.line, [])
    byLine.get(item.line).push(item)
  })

  const positioned = []

  function finalize(item, width, lineY) {
    const x = Math.max(8, Math.min(92, 50 + width * 40))
    const y = Math.max(6, Math.min(92, lineY - item.depthOffset))
    return { index: item.index, x, y }
  }

  byLine.forEach((lineItems, line) => {
    const lineY = lineYs[line] ?? lineYs[lineYs.length - 1]
    const wideGroups = new Map()
    const centralItems = []

    lineItems.forEach((item) => {
      if (Math.abs(item.width) >= WIDE_THRESHOLD) {
        if (!wideGroups.has(item.role)) wideGroups.set(item.role, [])
        wideGroups.get(item.role).push(item)
      } else {
        centralItems.push(item)
      }
    })

    wideGroups.forEach((group) => {
      const mag = Math.abs(group[0].width)
      if (group.length === 1) {
        positioned.push(finalize(group[0], group[0].width, lineY))
      } else {
        group.forEach((item, i) => {
          const sign = i % 2 === 0 ? -1 : 1
          const spread = mag + Math.floor(i / 2) * 0.12
          positioned.push(finalize(item, sign * spread, lineY))
        })
      }
    })

    const centralByOffset = new Map()
    centralItems.forEach((item) => {
      const key = item.depthOffset
      if (!centralByOffset.has(key)) centralByOffset.set(key, [])
      centralByOffset.get(key).push(item)
    })
    centralByOffset.forEach((group) => {
      const n = group.length
      group.forEach((item, i) => {
        const w = n > 1 ? (i - (n - 1) / 2) * 0.32 : 0
        positioned.push(finalize(item, w, lineY))
      })
    })
  })

  positioned.sort((a, b) => a.index - b.index)
  return positioned
}
