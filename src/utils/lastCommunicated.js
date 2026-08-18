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

const MONTH = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const TIME = "(\\d{1,2}):(\\d{2})(?::(\\d{2}))?";

// Lytx Vehicles uses US-style: "Aug 13, 2026, 1:36:40 PM"
const US_RE = new RegExp(
  `\\b(${MONTH})\\s+(\\d{1,2}),\\s+(\\d{4})(?:,\\s*${TIME}\\s*(AM|PM))?`,
  "i"
);

// Alternate: "8 Jul 2026, 11:05:02"
const DMY_RE = new RegExp(
  `\\b(\\d{1,2})\\s+(${MONTH})\\s+(\\d{4})(?:,\\s*${TIME})?`,
  "i"
);

const DEVICE_RE = /\b((?:MV|QM)\d{4,})\b/i;

export function parseDeviceNumber(text) {
  const match = String(text || "").match(DEVICE_RE);
  return match ? match[1].toUpperCase() : "";
}

export function isBlankLastCommunicated(raw) {
  const text = String(raw || "").trim();
  if (!text) return true;
  return /^[\u2014\u2013—–\-]+$/.test(text) || /^n\/?a$/i.test(text);
}

function hour24(hour, ampm) {
  let value = Number(hour);
  if (!ampm) return value;
  const period = String(ampm).toUpperCase();
  if (period === "AM") {
    if (value === 12) value = 0;
  } else if (period === "PM" && value !== 12) {
    value += 12;
  }
  return value;
}

function buildDate({ year, monthName, day, hour = 0, minute = 0, second = 0, ampm }) {
  const month = MONTHS[String(monthName || "").slice(0, 3).toLowerCase()];
  if (month == null || !day || !year) return null;
  const date = new Date(
    Number(year),
    month,
    Number(day),
    hour24(hour, ampm),
    Number(minute || 0),
    Number(second || 0)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseLastCommunicated(raw) {
  const text = String(raw || "").trim();
  if (isBlankLastCommunicated(text)) {
    return { kind: "missing", date: null, raw: text };
  }

  const us = text.match(US_RE);
  if (us) {
    const date = buildDate({
      monthName: us[1],
      day: us[2],
      year: us[3],
      hour: us[4],
      minute: us[5],
      second: us[6],
      ampm: us[7],
    });
    if (date) return { kind: "ok", date, raw: us[0].trim() };
  }

  const dmy = text.match(DMY_RE);
  if (dmy) {
    const date = buildDate({
      day: dmy[1],
      monthName: dmy[2],
      year: dmy[3],
      hour: dmy[4],
      minute: dmy[5],
      second: dmy[6],
    });
    if (date) return { kind: "ok", date, raw: dmy[0].trim() };
  }

  return { kind: "unparsed", date: null, raw: text };
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
  // Calendar days, not 48 hours. If today is the 13th and maxAgeDays is 2,
  // anything last communicated on the 11th (any time) or earlier is stale.
  const commDay = startOfLocalDay(parsed.date);
  const cutoff = startOfLocalDay(now);
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const stale = commDay.getTime() <= cutoff.getTime();
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
