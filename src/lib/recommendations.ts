import type { OwnedPokemon, Recommendation, Decision } from './types'
import { ivPercent, isHundo, isNundo } from './types'

/** Score how valuable a mon is for keeping in your box. */
function baseScore(p: OwnedPokemon): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0
  const iv = ivPercent(p)

  if (isHundo(p)) {
    score += 100
    reasons.push('Perfect 100% IV (hundo)')
  } else if (isNundo(p)) {
    score += 70
    reasons.push('0% IV (nundo) — rare flex')
  } else if (iv >= 96) {
    score += 55
    reasons.push(`${iv}% IV — near perfect`)
  } else if (iv >= 91) {
    score += 35
    reasons.push(`${iv}% IV — strong`)
  } else if (iv >= 80) {
    score += 15
    reasons.push(`${iv}% IV`)
  }

  if (p.shiny) {
    score += 80
    reasons.push('Shiny')
  }
  if (p.lucky) {
    score += 45
    reasons.push('Lucky')
  }
  if (p.shadow) {
    score += 40
    reasons.push('Shadow')
  }
  if (p.purified) {
    score += 20
    reasons.push('Purified')
  }
  if (p.favorite) {
    score += 50
    reasons.push('Favorited')
  }
  if (p.costume) {
    score += 60
    reasons.push(`Costume: ${p.costume}`)
  }
  if (p.cp >= 3000) {
    score += 20
    reasons.push(`High CP (${p.cp})`)
  } else if (p.cp >= 2500) {
    score += 10
    reasons.push(`Solid CP (${p.cp})`)
  }

  // Attack-weighted IV is useful for raids
  if (p.attackIV === 15 && iv >= 91) {
    score += 10
    reasons.push('15 attack — raid/attacker candidate')
  }

  return { score, reasons }
}

export function recommendAll(pokemon: OwnedPokemon[]): Recommendation[] {
  const bySpecies = new Map<number, OwnedPokemon[]>()
  for (const p of pokemon) {
    const list = bySpecies.get(p.speciesId) ?? []
    list.push(p)
    bySpecies.set(p.speciesId, list)
  }

  const bestBySpecies = new Map<string, number>()
  for (const [, group] of bySpecies) {
    const ranked = [...group].sort((a, b) => {
      const sa = baseScore(a).score
      const sb = baseScore(b).score
      if (sb !== sa) return sb - sa
      return ivPercent(b) - ivPercent(a)
    })
    ranked.forEach((p, i) => bestBySpecies.set(p.id, i))
  }

  return pokemon.map((p) => {
    if (p.decisionOverride) {
      return {
        pokemonId: p.id,
        decision: p.decisionOverride,
        reasons: [`Manual override: ${p.decisionOverride}`],
        score: p.decisionOverride === 'keep' ? 999 : 0,
      }
    }

    const { score, reasons } = baseScore(p)
    const rank = bestBySpecies.get(p.id) ?? 0
    const siblings = bySpecies.get(p.speciesId) ?? [p]
    const extra = [...reasons]

    if (rank === 0 && siblings.length > 1) {
      extra.push('Best of this species in your box')
    } else if (rank === 0) {
      extra.push('Only one of this species')
    }

    let decision: Decision
    const adjusted = score + (rank === 0 ? 25 : 0)

    if (adjusted >= 70 || p.shiny || isHundo(p) || p.favorite || p.costume) {
      decision = 'keep'
    } else if (
      siblings.length > 1 &&
      rank > 0 &&
      ivPercent(p) >= 82 &&
      !p.shadow &&
      adjusted >= 25
    ) {
      decision = 'trade'
      extra.push('Duplicate with tradeable IVs')
    } else if (siblings.length > 1 && rank > 0 && adjusted < 40) {
      decision = 'transfer'
      extra.push('Weaker duplicate — candy fodder')
    } else if (adjusted >= 40) {
      decision = 'review'
      extra.push('Borderline — check meta / PvP / personal goals')
    } else if (siblings.length === 1) {
      decision = 'keep'
      extra.push('Dex entry — keep at least one')
    } else {
      decision = 'transfer'
      if (extra.length === 0) extra.push('Low priority duplicate')
    }

    return {
      pokemonId: p.id,
      decision,
      reasons: extra,
      score: adjusted,
    }
  })
}

export function decisionLabel(d: Decision): string {
  switch (d) {
    case 'keep':
      return 'Keep'
    case 'trade':
      return 'Trade'
    case 'transfer':
      return 'Transfer'
    case 'review':
      return 'Review'
  }
}
