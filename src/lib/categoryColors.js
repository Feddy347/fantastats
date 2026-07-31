const CATEGORY_COLOR_VARS = {
  elite: '--color-elite',
  '7-sorelle': '--color-sorelle',
  sorprese: '--color-sorprese',
  'top-performers': '--color-top',
  'under-23': '--color-under23',
  'italians-do-it-better': '--color-italians',
}

export function getCategoryColorVar(slug) {
  return CATEGORY_COLOR_VARS[slug] ?? '--color-hype'
}
