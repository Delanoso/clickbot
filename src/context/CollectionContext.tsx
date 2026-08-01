import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import speciesData from '../data/species.json'
import { parseCollectionCsv, exportCollectionCsv } from '../lib/csv'
import { computeProgress } from '../lib/progress'
import { recommendAll } from '../lib/recommendations'
import {
  createDemoCollection,
  loadCollection,
  saveCollection,
} from '../lib/storage'
import type {
  Decision,
  OwnedPokemon,
  ProgressStats,
  Recommendation,
  Species,
} from '../lib/types'

const species = speciesData as Species[]

interface CollectionContextValue {
  species: Species[]
  pokemon: OwnedPokemon[]
  recommendations: Recommendation[]
  recommendationMap: Map<string, Recommendation>
  progress: ProgressStats
  speciesById: Map<number, Species>
  speciesByName: Map<string, number>
  getSpeciesName: (id: number) => string
  addPokemon: (p: Omit<OwnedPokemon, 'id'> & { id?: string }) => void
  updatePokemon: (id: string, patch: Partial<OwnedPokemon>) => void
  removePokemon: (id: string) => void
  setDecisionOverride: (id: string, decision: Decision | undefined) => void
  importCsv: (text: string, mode: 'merge' | 'replace') => { added: number; skipped: number; errors: string[] }
  exportCsv: () => string
  loadDemo: () => void
  clearAll: () => void
}

const CollectionContext = createContext<CollectionContextValue | null>(null)

function uid(): string {
  return `mon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [pokemon, setPokemon] = useState<OwnedPokemon[]>(() => {
    const loaded = loadCollection()
    return loaded.pokemon
  })
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveCollection({ pokemon, updatedAt: new Date().toISOString() })
  }, [pokemon, hydrated])

  const speciesById = useMemo(() => new Map(species.map((s) => [s.id, s])), [])
  const speciesByName = useMemo(
    () => new Map(species.map((s) => [s.name.toLowerCase(), s.id])),
    [],
  )

  const getSpeciesName = useCallback(
    (id: number) => speciesById.get(id)?.name ?? `#${id}`,
    [speciesById],
  )

  const recommendations = useMemo(() => recommendAll(pokemon), [pokemon])
  const recommendationMap = useMemo(
    () => new Map(recommendations.map((r) => [r.pokemonId, r])),
    [recommendations],
  )
  const progress = useMemo(
    () => computeProgress(pokemon, species, recommendations),
    [pokemon, recommendations],
  )

  const addPokemon = useCallback((p: Omit<OwnedPokemon, 'id'> & { id?: string }) => {
    setPokemon((prev) => [...prev, { ...p, id: p.id ?? uid() }])
  }, [])

  const updatePokemon = useCallback((id: string, patch: Partial<OwnedPokemon>) => {
    setPokemon((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const removePokemon = useCallback((id: string) => {
    setPokemon((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const setDecisionOverride = useCallback((id: string, decision: Decision | undefined) => {
    setPokemon((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, decisionOverride: decision } : p,
      ),
    )
  }, [])

  const importCsv = useCallback(
    (text: string, mode: 'merge' | 'replace') => {
      const result = parseCollectionCsv(text, speciesByName)
      setPokemon((prev) => (mode === 'replace' ? result.pokemon : [...prev, ...result.pokemon]))
      return { added: result.pokemon.length, skipped: result.skipped, errors: result.errors }
    },
    [speciesByName],
  )

  const exportCsv = useCallback(
    () => exportCollectionCsv(pokemon, getSpeciesName),
    [pokemon, getSpeciesName],
  )

  const loadDemo = useCallback(() => {
    setPokemon(createDemoCollection())
  }, [])

  const clearAll = useCallback(() => {
    setPokemon([])
  }, [])

  const value: CollectionContextValue = {
    species,
    pokemon,
    recommendations,
    recommendationMap,
    progress,
    speciesById,
    speciesByName,
    getSpeciesName,
    addPokemon,
    updatePokemon,
    removePokemon,
    setDecisionOverride,
    importCsv,
    exportCsv,
    loadDemo,
    clearAll,
  }

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>
}

export function useCollection(): CollectionContextValue {
  const ctx = useContext(CollectionContext)
  if (!ctx) throw new Error('useCollection must be used within CollectionProvider')
  return ctx
}
