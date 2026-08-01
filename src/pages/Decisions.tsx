import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCollection } from '../context/CollectionContext'
import { PokemonRow } from '../components/PokemonCard'
import type { Decision } from '../lib/types'
import { decisionLabel } from '../lib/recommendations'
import './Collection.css'
import './Decisions.css'

const FILTERS: Array<Decision | 'all'> = ['all', 'keep', 'trade', 'transfer', 'review']

export function DecisionsPage() {
  const { pokemon, recommendations, recommendationMap } = useCollection()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('filter') as Decision | 'all') || 'all'

  const list = useMemo(() => {
    const recs =
      filter === 'all' ? recommendations : recommendations.filter((r) => r.decision === filter)
    return recs
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((r) => ({
        pokemon: pokemon.find((p) => p.id === r.pokemonId)!,
        rec: r,
      }))
      .filter((x) => x.pokemon)
  }, [filter, recommendations, pokemon])

  return (
    <div className="decisions-page">
      <header className="page-head">
        <h1>Keep / Trade</h1>
        <p>
          Keeper scores each mon from IVs, shinies, luckies, shadows, costumes, and whether it is
          your best of species. Override any call manually.
        </p>
      </header>

      <div className="filter-tabs" role="tablist" aria-label="Decision filter">
        {FILTERS.map((f) => {
          const count =
            f === 'all'
              ? recommendations.length
              : recommendations.filter((r) => r.decision === f).length
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={`filter-tab ${filter === f ? 'active' : ''} ${f}`}
              onClick={() => setParams(f === 'all' ? {} : { filter: f })}
            >
              {f === 'all' ? 'All' : decisionLabel(f)}
              <span>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="legend">
        <p>
          <strong>Keep</strong> — hundos, shinies, best of species, favorites, costumes.
        </p>
        <p>
          <strong>Trade</strong> — strong duplicates worth sending to a friend.
        </p>
        <p>
          <strong>Transfer</strong> — weaker duplicates for candy.
        </p>
        <p>
          <strong>Review</strong> — borderline; check PvP or personal goals.
        </p>
      </div>

      <div className="mon-list">
        {list.map(({ pokemon: p, rec }) => (
          <PokemonRow
            key={p.id}
            pokemon={p}
            decision={recommendationMap.get(p.id)?.decision ?? rec.decision}
            reasons={rec.reasons}
          />
        ))}
        {list.length === 0 ? <p className="empty-hint">Nothing in this bucket yet.</p> : null}
      </div>
    </div>
  )
}
