import { ivPercent, spriteUrl, type OwnedPokemon, type Decision } from '../lib/types'
import { decisionLabel } from '../lib/recommendations'
import { useCollection } from '../context/CollectionContext'
import './PokemonCard.css'

interface Props {
  pokemon: OwnedPokemon
  decision?: Decision
  reasons?: string[]
  compact?: boolean
  onRemove?: () => void
}

export function PokemonRow({ pokemon, decision, reasons, compact, onRemove }: Props) {
  const { getSpeciesName, setDecisionOverride } = useCollection()
  const name = getSpeciesName(pokemon.speciesId)
  const iv = ivPercent(pokemon)

  return (
    <article className={`mon-row ${compact ? 'compact' : ''} decision-${decision ?? 'none'}`}>
      <div className="mon-sprite-wrap">
        <img
          src={spriteUrl(pokemon.speciesId, pokemon.shiny)}
          alt=""
          className="mon-sprite"
          loading="lazy"
          width={72}
          height={72}
        />
      </div>
      <div className="mon-body">
        <div className="mon-title-row">
          <h3 className="mon-name">
            {pokemon.nickname || name}
            {pokemon.nickname ? <span className="mon-species"> · {name}</span> : null}
          </h3>
          {decision ? <span className={`pill decision-pill ${decision}`}>{decisionLabel(decision)}</span> : null}
        </div>
        <div className="mon-meta">
          <span>CP {pokemon.cp || '—'}</span>
          <span>
            IV {pokemon.attackIV}/{pokemon.defenseIV}/{pokemon.staminaIV} ({iv}%)
          </span>
          {pokemon.level != null ? <span>Lv {pokemon.level}</span> : null}
        </div>
        <div className="mon-tags">
          {pokemon.shiny ? <span className="tag shiny">Shiny</span> : null}
          {pokemon.lucky ? <span className="tag lucky">Lucky</span> : null}
          {pokemon.shadow ? <span className="tag shadow">Shadow</span> : null}
          {pokemon.purified ? <span className="tag purified">Purified</span> : null}
          {pokemon.favorite ? <span className="tag fav">Favorite</span> : null}
          {pokemon.costume ? <span className="tag costume">{pokemon.costume}</span> : null}
        </div>
        {!compact && reasons && reasons.length > 0 ? (
          <ul className="mon-reasons">
            {reasons.slice(0, 4).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
        {!compact ? (
          <div className="mon-actions">
            {(['keep', 'trade', 'transfer', 'review'] as Decision[]).map((d) => (
              <button
                key={d}
                type="button"
                className={`btn-ghost ${pokemon.decisionOverride === d ? 'selected' : ''}`}
                onClick={() =>
                  setDecisionOverride(
                    pokemon.id,
                    pokemon.decisionOverride === d ? undefined : d,
                  )
                }
              >
                {decisionLabel(d)}
              </button>
            ))}
            {onRemove ? (
              <button type="button" className="btn-ghost danger" onClick={onRemove}>
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}
