import { useMemo, useState } from 'react'
import { useCollection } from '../context/CollectionContext'
import { PokemonRow } from '../components/PokemonCard'
import { ivPercent } from '../lib/types'
import './Collection.css'

type SortKey = 'name' | 'cp' | 'iv' | 'recent'

export function CollectionPage() {
  const { pokemon, recommendationMap, getSpeciesName, removePokemon, species } = useCollection()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('iv')
  const [shinyOnly, setShinyOnly] = useState(false)
  const [gen, setGen] = useState<number | 'all'>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = [...pokemon]
    if (q) {
      list = list.filter((p) => {
        const name = getSpeciesName(p.speciesId).toLowerCase()
        return (
          name.includes(q) ||
          (p.nickname?.toLowerCase().includes(q) ?? false) ||
          String(p.speciesId).includes(q)
        )
      })
    }
    if (shinyOnly) list = list.filter((p) => p.shiny)
    if (gen !== 'all') {
      const ids = new Set(species.filter((s) => s.generation === gen).map((s) => s.id))
      list = list.filter((p) => ids.has(p.speciesId))
    }
    list.sort((a, b) => {
      if (sort === 'cp') return b.cp - a.cp
      if (sort === 'iv') return ivPercent(b) - ivPercent(a)
      if (sort === 'recent') return (b.caughtAt ?? '').localeCompare(a.caughtAt ?? '')
      return getSpeciesName(a.speciesId).localeCompare(getSpeciesName(b.speciesId))
    })
    return list
  }, [pokemon, query, sort, shinyOnly, gen, getSpeciesName, species])

  return (
    <div className="collection-page">
      <header className="page-head">
        <h1>Box</h1>
        <p>
          {pokemon.length} Pokémon · {filtered.length} showing
        </p>
      </header>

      <div className="filters">
        <input
          type="search"
          placeholder="Search species or nickname…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input"
        />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="iv">Sort by IV</option>
          <option value="cp">Sort by CP</option>
          <option value="name">Sort by name</option>
          <option value="recent">Sort by recent</option>
        </select>
        <select
          className="input"
          value={gen}
          onChange={(e) => setGen(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">All gens</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => (
            <option key={g} value={g}>
              Gen {g}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={shinyOnly} onChange={(e) => setShinyOnly(e.target.checked)} />
          Shinies only
        </label>
      </div>

      <div className="mon-list">
        {filtered.map((p) => {
          const rec = recommendationMap.get(p.id)
          return (
            <PokemonRow
              key={p.id}
              pokemon={p}
              decision={rec?.decision}
              reasons={rec?.reasons}
              onRemove={() => removePokemon(p.id)}
            />
          )
        })}
        {filtered.length === 0 ? (
          <p className="empty-hint">No Pokémon match these filters.</p>
        ) : null}
      </div>
    </div>
  )
}
