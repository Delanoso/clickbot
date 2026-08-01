import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '../context/CollectionContext'
import './Collection.css'
import './Add.css'

export function AddPage() {
  const { species, addPokemon } = useCollection()
  const navigate = useNavigate()
  const [speciesQuery, setSpeciesQuery] = useState('')
  const [speciesId, setSpeciesId] = useState<number>(25)
  const [cp, setCp] = useState(1500)
  const [attackIV, setAttackIV] = useState(15)
  const [defenseIV, setDefenseIV] = useState(15)
  const [staminaIV, setStaminaIV] = useState(15)
  const [level, setLevel] = useState(30)
  const [nickname, setNickname] = useState('')
  const [shiny, setShiny] = useState(false)
  const [lucky, setLucky] = useState(false)
  const [shadow, setShadow] = useState(false)
  const [purified, setPurified] = useState(false)
  const [favorite, setFavorite] = useState(false)
  const [costume, setCostume] = useState('')

  const matches = useMemo(() => {
    const q = speciesQuery.trim().toLowerCase()
    if (!q) return species.slice(0, 12)
    return species.filter((s) => s.name.toLowerCase().includes(q) || String(s.id).includes(q)).slice(0, 12)
  }, [species, speciesQuery])

  function submit(e: FormEvent) {
    e.preventDefault()
    addPokemon({
      speciesId,
      cp,
      attackIV,
      defenseIV,
      staminaIV,
      level,
      nickname: nickname || undefined,
      shiny,
      lucky,
      shadow,
      purified,
      favorite,
      costume: costume || undefined,
      source: 'manual',
      caughtAt: new Date().toISOString(),
    })
    navigate('/collection')
  }

  return (
    <div className="add-page">
      <header className="page-head">
        <h1>Add Pokémon</h1>
        <p>Log a catch manually when you do not have a CSV handy.</p>
      </header>

      <form className="add-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="species-search">Species</label>
          <input
            id="species-search"
            className="input"
            value={speciesQuery}
            onChange={(e) => setSpeciesQuery(e.target.value)}
            placeholder="Search Pikachu, 25, Charizard…"
          />
          <div className="species-picks" role="listbox">
            {matches.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`species-pick ${speciesId === s.id ? 'selected' : ''}`}
                onClick={() => {
                  setSpeciesId(s.id)
                  setSpeciesQuery(s.name)
                }}
              >
                <img
                  src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${s.id}.png`}
                  alt=""
                  width={40}
                  height={40}
                />
                <span>
                  {s.name} <em>#{s.id}</em>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="field-grid">
          <label>
            CP
            <input
              className="input"
              type="number"
              min={10}
              max={9999}
              value={cp}
              onChange={(e) => setCp(Number(e.target.value))}
            />
          </label>
          <label>
            Level
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              step={0.5}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
            />
          </label>
          <label>
            Atk IV
            <input
              className="input"
              type="number"
              min={0}
              max={15}
              value={attackIV}
              onChange={(e) => setAttackIV(Number(e.target.value))}
            />
          </label>
          <label>
            Def IV
            <input
              className="input"
              type="number"
              min={0}
              max={15}
              value={defenseIV}
              onChange={(e) => setDefenseIV(Number(e.target.value))}
            />
          </label>
          <label>
            Sta IV
            <input
              className="input"
              type="number"
              min={0}
              max={15}
              value={staminaIV}
              onChange={(e) => setStaminaIV(Number(e.target.value))}
            />
          </label>
          <label>
            Nickname
            <input
              className="input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
        </div>

        <div className="flag-row">
          <label className="check">
            <input type="checkbox" checked={shiny} onChange={(e) => setShiny(e.target.checked)} />
            Shiny
          </label>
          <label className="check">
            <input type="checkbox" checked={lucky} onChange={(e) => setLucky(e.target.checked)} />
            Lucky
          </label>
          <label className="check">
            <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} />
            Shadow
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={purified}
              onChange={(e) => setPurified(e.target.checked)}
            />
            Purified
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
            />
            Favorite
          </label>
        </div>

        <label className="field">
          Costume
          <input
            className="input"
            value={costume}
            onChange={(e) => setCostume(e.target.value)}
            placeholder="Party Hat, Flower Crown…"
          />
        </label>

        <button type="submit" className="btn primary">
          Add to box
        </button>
      </form>
    </div>
  )
}
