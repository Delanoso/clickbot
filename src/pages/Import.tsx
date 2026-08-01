import { useRef, useState } from 'react'
import { useCollection } from '../context/CollectionContext'
import './Collection.css'
import './Import.css'

const SAMPLE_CSV = `Species,CP,Attack IV,Defense IV,Stamina IV,Shiny,Lucky,Shadow,Favorite
Pikachu,1850,15,14,15,true,false,false,true
Charizard,3200,15,15,15,false,true,false,true
Gengar,2400,10,8,9,false,false,false,false
Tyranitar,3500,15,15,14,false,false,true,true
Eevee,600,0,0,0,false,false,false,true
`

export function ImportPage() {
  const { importCsv, exportCsv, getSpeciesName, pokemon } = useCollection()
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [result, setResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(
    null,
  )
  const fileRef = useRef<HTMLInputElement>(null)

  function runImport(csv: string) {
    const res = importCsv(csv, mode)
    setResult(res)
  }

  function onFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result ?? '')
      setText(content)
      runImport(content)
    }
    reader.readAsText(file)
  }

  function downloadExport() {
    const csv = exportCsv()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `keeper-collection-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="import-page">
      <header className="page-head">
        <h1>Import</h1>
        <p>
          Drop a CSV to update your box automatically. Columns like Species, CP, Attack IV, Shiny,
          Lucky, Shadow are detected flexibly (Calcy / Genie-style exports work with light cleanup).
        </p>
      </header>

      <div className="import-panel">
        <div className="mode-row">
          <label className="check">
            <input
              type="radio"
              name="mode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
            />
            Merge into box
          </label>
          <label className="check">
            <input
              type="radio"
              name="mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            Replace box
          </label>
        </div>

        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            onFile(e.dataTransfer.files[0])
          }}
        >
          <p>Drag & drop a CSV here</p>
          <button type="button" className="btn secondary" onClick={() => fileRef.current?.click()}>
            Choose file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>

        <label className="field-label" htmlFor="csv-text">
          Or paste CSV
        </label>
        <textarea
          id="csv-text"
          className="input textarea"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={SAMPLE_CSV}
        />

        <div className="import-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!text.trim()}
            onClick={() => runImport(text)}
          >
            Import
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setText(SAMPLE_CSV)
              runImport(SAMPLE_CSV)
            }}
          >
            Try sample CSV
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={pokemon.length === 0}
            onClick={downloadExport}
          >
            Export current box
          </button>
        </div>

        {result ? (
          <div className="import-result" role="status">
            <p>
              Added <strong>{result.added}</strong>
              {result.skipped ? <> · skipped {result.skipped}</> : null}
            </p>
            {result.errors.length > 0 ? (
              <ul>
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="format-help">
        <h2>Expected columns</h2>
        <p>
          Minimum: <code>Species</code> (or <code>Species ID</code>). Useful extras:{' '}
          <code>CP</code>, <code>Attack IV</code>, <code>Defense IV</code>, <code>Stamina IV</code>,{' '}
          <code>Level</code>, <code>Shiny</code>, <code>Lucky</code>, <code>Shadow</code>,{' '}
          <code>Purified</code>, <code>Favorite</code>, <code>Costume</code>, <code>Nickname</code>.
        </p>
        <p className="hint">
          Example species in your catalog: {getSpeciesName(25)}, {getSpeciesName(6)},{' '}
          {getSpeciesName(150)}…
        </p>
      </section>
    </div>
  )
}
