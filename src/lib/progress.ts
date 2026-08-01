import type { OwnedPokemon, ProgressStats, Recommendation, Species } from './types'
import { isHundo } from './types'

export function computeProgress(
  pokemon: OwnedPokemon[],
  species: Species[],
  recommendations: Recommendation[],
): ProgressStats {
  const unique = new Set(pokemon.map((p) => p.speciesId))
  const shinySpecies = new Set(pokemon.filter((p) => p.shiny).map((p) => p.speciesId))
  const byGenOwned = new Map<number, Set<number>>()
  const byGenTotal = new Map<number, number>()

  for (const s of species) {
    byGenTotal.set(s.generation, (byGenTotal.get(s.generation) ?? 0) + 1)
  }
  for (const p of pokemon) {
    const sp = species.find((s) => s.id === p.speciesId)
    if (!sp) continue
    const set = byGenOwned.get(sp.generation) ?? new Set()
    set.add(p.speciesId)
    byGenOwned.set(sp.generation, set)
  }

  const recMap = new Map(recommendations.map((r) => [r.pokemonId, r.decision]))
  let keepCount = 0
  let tradeCount = 0
  let transferCount = 0
  let reviewCount = 0
  for (const p of pokemon) {
    const d = recMap.get(p.id)
    if (d === 'keep') keepCount++
    else if (d === 'trade') tradeCount++
    else if (d === 'transfer') transferCount++
    else reviewCount++
  }

  const generations = [...byGenTotal.keys()].sort((a, b) => a - b)

  return {
    uniqueSpecies: unique.size,
    totalSpecies: species.length,
    shinySpecies: shinySpecies.size,
    luckyCount: pokemon.filter((p) => p.lucky).length,
    hundoCount: pokemon.filter((p) => isHundo(p)).length,
    shadowCount: pokemon.filter((p) => p.shadow).length,
    totalOwned: pokemon.length,
    byGeneration: generations.map((generation) => ({
      generation,
      owned: byGenOwned.get(generation)?.size ?? 0,
      total: byGenTotal.get(generation) ?? 0,
    })),
    keepCount,
    tradeCount,
    transferCount,
    reviewCount,
  }
}
