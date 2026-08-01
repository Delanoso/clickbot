import type { OwnedPokemon } from './types'

function uid(): string {
  return `mon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function parseBool(v: string | undefined): boolean {
  if (!v) return false
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'shiny'
}

function parseIntSafe(v: string | undefined, fallback = 0): number {
  if (v == null || v.trim() === '') return fallback
  const n = Number.parseInt(v.replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const SPECIES_ALIASES: Record<string, string> = {
  pokemon: 'species',
  name: 'species',
  mon: 'species',
  pokedex: 'speciesid',
  'pokedex #': 'speciesid',
  'dex #': 'speciesid',
  dex: 'speciesid',
  'species id': 'speciesid',
  'species_id': 'speciesid',
  'pokemon id': 'speciesid',
  'nat dex': 'speciesid',
  atk: 'attack',
  attack: 'attack',
  'atk iv': 'attack',
  'attack iv': 'attack',
  def: 'defense',
  defense: 'defense',
  'def iv': 'defense',
  'defense iv': 'defense',
  sta: 'stamina',
  stamina: 'stamina',
  hp: 'stamina',
  'sta iv': 'stamina',
  'hp iv': 'stamina',
  'stamina iv': 'stamina',
  iv: 'iv',
  'iv %': 'iv',
  'iv%': 'iv',
  level: 'level',
  lvl: 'level',
  cp: 'cp',
  shiny: 'shiny',
  lucky: 'lucky',
  shadow: 'shadow',
  purified: 'purified',
  favorite: 'favorite',
  favourite: 'favorite',
  costume: 'costume',
  form: 'costume',
  nickname: 'nickname',
  nick: 'nickname',
  gender: 'gender',
  notes: 'notes',
  note: 'notes',
}

function normalizeHeader(h: string): string {
  const key = h.trim().toLowerCase()
  return SPECIES_ALIASES[key] ?? key.replace(/\s+/g, '')
}

export interface CsvImportResult {
  pokemon: OwnedPokemon[]
  skipped: number
  errors: string[]
}

export function parseCollectionCsv(
  text: string,
  speciesByName: Map<string, number>,
): CsvImportResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)

  if (lines.length < 2) {
    return { pokemon: [], skipped: 0, errors: ['CSV needs a header row and at least one data row.'] }
  }

  const headers = splitCsvLine(lines[0]).map(normalizeHeader)
  const pokemon: OwnedPokemon[] = []
  const errors: string[] = []
  let skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? ''
    })

    let speciesId = parseIntSafe(row.speciesid, 0)
    if (!speciesId && row.species) {
      const key = row.species.trim().toLowerCase()
      speciesId = speciesByName.get(key) ?? 0
    }

    if (!speciesId) {
      skipped++
      errors.push(`Row ${i + 1}: could not resolve species "${row.species || row.speciesid || ''}"`)
      continue
    }

    let attackIV = parseIntSafe(row.attack, -1)
    let defenseIV = parseIntSafe(row.defense, -1)
    let staminaIV = parseIntSafe(row.stamina, -1)

    // Support combined IV column like "15/14/15" or "15-14-15"
    if ((attackIV < 0 || defenseIV < 0 || staminaIV < 0) && row.iv && row.iv.includes('/')) {
      const parts = row.iv.split(/[/|-]/).map((p) => parseIntSafe(p, 0))
      attackIV = parts[0] ?? 0
      defenseIV = parts[1] ?? 0
      staminaIV = parts[2] ?? 0
    }

    attackIV = Math.min(15, Math.max(0, attackIV < 0 ? 0 : attackIV))
    defenseIV = Math.min(15, Math.max(0, defenseIV < 0 ? 0 : defenseIV))
    staminaIV = Math.min(15, Math.max(0, staminaIV < 0 ? 0 : staminaIV))

    const genderRaw = (row.gender || '').toLowerCase()
    let gender: OwnedPokemon['gender'] = 'unknown'
    if (genderRaw.startsWith('m')) gender = 'male'
    else if (genderRaw.startsWith('f')) gender = 'female'
    else if (genderRaw.includes('less') || genderRaw === 'n') gender = 'genderless'

    pokemon.push({
      id: uid(),
      speciesId,
      nickname: row.nickname || undefined,
      cp: parseIntSafe(row.cp, 0),
      attackIV,
      defenseIV,
      staminaIV,
      level: row.level ? parseIntSafe(row.level, 0) || undefined : undefined,
      shiny: parseBool(row.shiny),
      lucky: parseBool(row.lucky),
      shadow: parseBool(row.shadow),
      purified: parseBool(row.purified),
      favorite: parseBool(row.favorite),
      costume: row.costume || undefined,
      gender,
      notes: row.notes || undefined,
      source: 'csv',
      caughtAt: new Date().toISOString(),
    })
  }

  return { pokemon, skipped, errors: errors.slice(0, 20) }
}

export function exportCollectionCsv(
  pokemon: OwnedPokemon[],
  speciesName: (id: number) => string,
): string {
  const header = [
    'Species',
    'Species ID',
    'Nickname',
    'CP',
    'Attack IV',
    'Defense IV',
    'Stamina IV',
    'Level',
    'Shiny',
    'Lucky',
    'Shadow',
    'Purified',
    'Favorite',
    'Costume',
    'Gender',
    'Notes',
    'Decision Override',
  ]
  const rows = pokemon.map((p) =>
    [
      speciesName(p.speciesId),
      p.speciesId,
      p.nickname ?? '',
      p.cp,
      p.attackIV,
      p.defenseIV,
      p.staminaIV,
      p.level ?? '',
      p.shiny,
      p.lucky,
      p.shadow,
      p.purified,
      p.favorite,
      p.costume ?? '',
      p.gender ?? '',
      p.notes ?? '',
      p.decisionOverride ?? '',
    ]
      .map((v) => {
        const s = String(v)
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      })
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}
