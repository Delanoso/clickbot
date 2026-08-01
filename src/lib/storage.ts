import type { CollectionState, OwnedPokemon } from './types'
import { ivPercent } from './types'

const KEY = 'keeper.pogo.collection.v1'

export function loadCollection(): CollectionState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { pokemon: [], updatedAt: new Date().toISOString() }
    const parsed = JSON.parse(raw) as CollectionState
    if (!parsed || !Array.isArray(parsed.pokemon)) {
      return { pokemon: [], updatedAt: new Date().toISOString() }
    }
    return parsed
  } catch {
    return { pokemon: [], updatedAt: new Date().toISOString() }
  }
}

export function saveCollection(state: CollectionState): void {
  localStorage.setItem(KEY, JSON.stringify(state))
}

function uid(): string {
  return `mon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Demo box so the app feels alive on first visit. */
export function createDemoCollection(): OwnedPokemon[] {
  const samples: Omit<OwnedPokemon, 'id'>[] = [
    { speciesId: 25, cp: 2145, attackIV: 15, defenseIV: 15, staminaIV: 14, shiny: true, lucky: false, shadow: false, purified: false, favorite: true, level: 40 },
    { speciesId: 6, cp: 3421, attackIV: 15, defenseIV: 15, staminaIV: 15, shiny: false, lucky: true, shadow: false, purified: false, favorite: true, level: 50 },
    { speciesId: 6, cp: 2890, attackIV: 12, defenseIV: 11, staminaIV: 10, shiny: false, lucky: false, shadow: false, purified: false, favorite: false, level: 35 },
    { speciesId: 150, cp: 3680, attackIV: 15, defenseIV: 14, staminaIV: 15, shiny: false, lucky: false, shadow: true, purified: false, favorite: true, level: 40 },
    { speciesId: 248, cp: 3550, attackIV: 15, defenseIV: 15, staminaIV: 15, shiny: false, lucky: false, shadow: false, purified: false, favorite: true, level: 45 },
    { speciesId: 130, cp: 3012, attackIV: 14, defenseIV: 14, staminaIV: 14, shiny: true, lucky: true, shadow: false, purified: false, favorite: true, level: 40 },
    { speciesId: 94, cp: 2780, attackIV: 13, defenseIV: 12, staminaIV: 14, shiny: false, lucky: false, shadow: true, purified: false, favorite: false, level: 35 },
    { speciesId: 94, cp: 2100, attackIV: 8, defenseIV: 7, staminaIV: 9, shiny: false, lucky: false, shadow: false, purified: false, favorite: false, level: 28 },
    { speciesId: 149, cp: 3200, attackIV: 15, defenseIV: 13, staminaIV: 14, shiny: false, lucky: false, shadow: false, purified: false, favorite: false, level: 40 },
    { speciesId: 445, cp: 3401, attackIV: 15, defenseIV: 15, staminaIV: 14, shiny: false, lucky: true, shadow: false, purified: false, favorite: true, level: 42 },
    { speciesId: 282, cp: 2980, attackIV: 14, defenseIV: 15, staminaIV: 15, shiny: true, lucky: false, shadow: false, purified: false, favorite: true, level: 40 },
    { speciesId: 373, cp: 3100, attackIV: 15, defenseIV: 12, staminaIV: 13, shiny: false, lucky: false, shadow: true, purified: false, favorite: false, level: 38 },
    { speciesId: 448, cp: 3055, attackIV: 15, defenseIV: 15, staminaIV: 15, shiny: false, lucky: false, shadow: false, purified: true, favorite: true, level: 40 },
    { speciesId: 1, cp: 900, attackIV: 10, defenseIV: 10, staminaIV: 10, shiny: false, lucky: false, shadow: false, purified: false, favorite: false, level: 20, costume: 'Party Hat' },
    { speciesId: 133, cp: 1100, attackIV: 0, defenseIV: 0, staminaIV: 0, shiny: false, lucky: false, shadow: false, purified: false, favorite: true, level: 20 },
    { speciesId: 700, cp: 2800, attackIV: 15, defenseIV: 14, staminaIV: 14, shiny: true, lucky: false, shadow: false, purified: false, favorite: true, level: 40 },
    { speciesId: 145, cp: 2900, attackIV: 14, defenseIV: 14, staminaIV: 15, shiny: false, lucky: true, shadow: false, purified: false, favorite: false, level: 35 },
    { speciesId: 250, cp: 3600, attackIV: 15, defenseIV: 15, staminaIV: 14, shiny: false, lucky: false, shadow: false, purified: false, favorite: true, level: 45 },
    { speciesId: 16, cp: 450, attackIV: 5, defenseIV: 4, staminaIV: 6, shiny: false, lucky: false, shadow: false, purified: false, favorite: false, level: 15 },
    { speciesId: 16, cp: 520, attackIV: 11, defenseIV: 10, staminaIV: 12, shiny: false, lucky: false, shadow: false, purified: false, favorite: false, level: 18 },
  ]

  return samples.map((s) => ({
    ...s,
    id: uid(),
    notes: `Demo · ${ivPercent(s)}% IV`,
    source: 'demo',
    caughtAt: new Date().toISOString(),
  }))
}
