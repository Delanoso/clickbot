const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const DATE_RE =
  /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2}):(\d{2}))?/i;
const DEVICE_RE = /\b((?:MV|QM)\d{4,})\b/i;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseDeviceNumber(text) {
  const match = String(text || "").match(DEVICE_RE);
  return match ? match[1].toUpperCase() : "";
}

export function isBlankLastCommunicated(raw) {
  const text = String(raw || "").trim();
  if (!text) return true;
  return /^[\u2014\u2013—–\-]+$/.test(text) || /^n\/?a$/i.test(text);
}

export function parseLastCommunicated(raw) {
  const text = String(raw || "").trim();
  if (isBlankLastCommunicated(text)) {
    return { kind: "missing", date: null, raw: text };
  }
  const match = text.match(DATE_RE);
  if (!match) {
    return { kind: "unparsed", date: null, raw: text };
  }
  const day = Number(match[1]);
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  const year = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  if (month == null || !day || !year) {
    return { kind: "unparsed", date: null, raw: text };
  }
  const date = new Date(year, month, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) {
    return { kind: "unparsed", date: null, raw: text };
  }
  return { kind: "ok", date, raw: match[0] };
}

export function classifyLastCommunicated(
  raw,
  { maxAgeDays = 2, now = new Date() } = {}
) {
  const parsed = parseLastCommunicated(raw);
  if (parsed.kind === "unparsed") {
    return { stale: false, reason: "unparsed", date: null, ageMs: null, raw: parsed.raw };
  }
  if (parsed.kind === "missing") {
    return { stale: true, reason: "missing", date: null, ageMs: null, raw: parsed.raw };
  }
  const ageMs = now.getTime() - parsed.date.getTime();
  const stale = ageMs > maxAgeDays * MS_PER_DAY;
  return {
    stale,
    reason: stale ? "older_than_max_age" : "recent",
    date: parsed.date,
    ageMs,
    raw: parsed.raw,
  };
}

export function lastCommunicatedComment(raw) {
  const text = String(raw || "").trim();
  return text ? `Last communicated: ${text}` : "Last communicated: none";
}
