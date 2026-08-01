export type Decision = 'keep' | 'trade' | 'transfer' | 'review'

export interface Species {
  id: number
  name: string
  generation: number
}

export interface OwnedPokemon {
  id: string
  speciesId: number
  nickname?: string
  cp: number
  attackIV: number
  defenseIV: number
  staminaIV: number
  level?: number
  shiny: boolean
  lucky: boolean
  shadow: boolean
  purified: boolean
  favorite: boolean
  costume?: string
  gender?: 'male' | 'female' | 'genderless' | 'unknown'
  caughtAt?: string
  notes?: string
  decisionOverride?: Decision
  source?: string
}

export interface CollectionState {
  pokemon: OwnedPokemon[]
  updatedAt: string
}

export interface Recommendation {
  pokemonId: string
  decision: Decision
  reasons: string[]
  score: number
}

export interface ProgressStats {
  uniqueSpecies: number
  totalSpecies: number
  shinySpecies: number
  luckyCount: number
  hundoCount: number
  shadowCount: number
  totalOwned: number
  byGeneration: { generation: number; owned: number; total: number }[]
  keepCount: number
  tradeCount: number
  transferCount: number
  reviewCount: number
}

export function ivPercent(p: Pick<OwnedPokemon, 'attackIV' | 'defenseIV' | 'staminaIV'>): number {
  return Math.round(((p.attackIV + p.defenseIV + p.staminaIV) / 45) * 100)
}

export function isHundo(p: Pick<OwnedPokemon, 'attackIV' | 'defenseIV' | 'staminaIV'>): boolean {
  return p.attackIV === 15 && p.defenseIV === 15 && p.staminaIV === 15
}

export function isNundo(p: Pick<OwnedPokemon, 'attackIV' | 'defenseIV' | 'staminaIV'>): boolean {
  return p.attackIV === 0 && p.defenseIV === 0 && p.staminaIV === 0
}

export function spriteUrl(speciesId: number, shiny = false): string {
  if (shiny) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${speciesId}.png`
  }
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${speciesId}.png`
}
