import { Link } from 'react-router-dom'
import { useCollection } from '../context/CollectionContext'
import { PokemonRow } from '../components/PokemonCard'
import './Overview.css'

export function OverviewPage() {
  const { progress, pokemon, recommendations, recommendationMap, loadDemo, clearAll } =
    useCollection()
  const dexPct = progress.totalSpecies
    ? Math.round((progress.uniqueSpecies / progress.totalSpecies) * 100)
    : 0

  const topKeep = recommendations
    .filter((r) => r.decision === 'keep')
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => pokemon.find((p) => p.id === r.pokemonId)!)
    .filter(Boolean)

  const tradeReady = recommendations.filter((r) => r.decision === 'trade').length
  const transferReady = recommendations.filter((r) => r.decision === 'transfer').length

  return (
    <div className="overview">
      <section className="hero">
        <p className="hero-brand">Keeper</p>
        <h1 className="hero-title">Your Pokémon GO box, sorted.</h1>
        <p className="hero-sub">
          Track what you own, see what to keep or trade, and watch dex progress update as you
          import.
        </p>
        <div className="hero-cta">
          <Link className="btn primary" to="/import">
            Import collection
          </Link>
          <Link className="btn secondary" to="/add">
            Add one
          </Link>
          {pokemon.length === 0 ? (
            <button type="button" className="btn ghost" onClick={loadDemo}>
              Load demo box
            </button>
          ) : null}
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit">
            {[25, 6, 150, 248, 130].map((id, i) => (
              <img
                key={id}
                className={`orbit-mon m${i}`}
                src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`}
                alt=""
              />
            ))}
          </div>
        </div>
      </section>

      <section className="progress-section">
        <header className="section-head">
          <h2>Progress</h2>
          <p>Caught species across the national dex available in your box.</p>
        </header>

        <div className="dex-ring-wrap">
          <div
            className="dex-ring"
            style={{ ['--pct' as string]: `${dexPct}` }}
            role="img"
            aria-label={`${dexPct}% of national dex`}
          >
            <div className="dex-ring-inner">
              <strong>{dexPct}%</strong>
              <span>
                {progress.uniqueSpecies}/{progress.totalSpecies}
              </span>
            </div>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <strong>{progress.totalOwned}</strong>
              <span>In box</span>
            </div>
            <div className="stat">
              <strong>{progress.shinySpecies}</strong>
              <span>Shiny species</span>
            </div>
            <div className="stat">
              <strong>{progress.hundoCount}</strong>
              <span>Hundos</span>
            </div>
            <div className="stat">
              <strong>{progress.luckyCount}</strong>
              <span>Lucky</span>
            </div>
            <div className="stat">
              <strong>{progress.shadowCount}</strong>
              <span>Shadow</span>
            </div>
            <div className="stat">
              <strong>{tradeReady + transferReady}</strong>
              <span>Actionable</span>
            </div>
          </div>
        </div>

        <div className="gen-bars">
          {progress.byGeneration.map((g) => {
            const pct = g.total ? Math.round((g.owned / g.total) * 100) : 0
            return (
              <div key={g.generation} className="gen-bar">
                <div className="gen-bar-label">
                  <span>Gen {g.generation}</span>
                  <span>
                    {g.owned}/{g.total}
                  </span>
                </div>
                <div className="gen-bar-track">
                  <div className="gen-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="decision-snapshot">
        <header className="section-head">
          <h2>What to do next</h2>
          <p>Auto-ranked from IVs, shinies, luckies, shadows, and duplicates.</p>
        </header>
        <div className="decision-counts">
          <Link to="/decisions?filter=keep" className="count keep">
            <strong>{progress.keepCount}</strong>
            <span>Keep</span>
          </Link>
          <Link to="/decisions?filter=trade" className="count trade">
            <strong>{progress.tradeCount}</strong>
            <span>Trade</span>
          </Link>
          <Link to="/decisions?filter=transfer" className="count transfer">
            <strong>{progress.transferCount}</strong>
            <span>Transfer</span>
          </Link>
          <Link to="/decisions?filter=review" className="count review">
            <strong>{progress.reviewCount}</strong>
            <span>Review</span>
          </Link>
        </div>

        {topKeep.length > 0 ? (
          <div className="top-keeps">
            <h3>Top keeps</h3>
            {topKeep.map((p, i) => (
              <div key={p.id} style={{ animationDelay: `${i * 60}ms` }}>
                <PokemonRow
                  pokemon={p}
                  decision={recommendationMap.get(p.id)?.decision}
                  reasons={recommendationMap.get(p.id)?.reasons}
                  compact
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-hint">
            Your box is empty. Import a CSV from Calcy IV / Poke Genie style exports, add Pokémon
            manually, or load the demo box.
          </p>
        )}
      </section>

      {pokemon.length > 0 ? (
        <div className="danger-zone">
          <button type="button" className="btn ghost" onClick={loadDemo}>
            Reset to demo
          </button>
          <button type="button" className="btn ghost danger" onClick={clearAll}>
            Clear box
          </button>
        </div>
      ) : null}
    </div>
  )
}
