import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isInTargetArea } from "./depotMonitor.js";

const areasPath = join(dirname(fileURLToPath(import.meta.url)), "johannesburgAreas.json");
const johannesburgAreas = JSON.parse(readFileSync(areasPath, "utf8"));

const DEFAULT_DEPOT_AREAS = {
  targetArea: "N Boundary Road, Boksburg 1459, ZA",
  targetAreas: [
    "N Boundary Road, Boksburg 1459, ZA",
    "N Boundary Road, Boksburg",
    "HFR - Boksburg Depot",
    "Boksburg Depot",
    "North Boundary Road, Salfin, Boksburg",
    "Windmill Park, Boksburg 1459, ZA",
    "Windmill Park",
    "Salfin, Boksburg",
    "Insingizi, Boksburg, 1459, ZA",
    "Insingizi, Boksburg 1459, ZA",
    "Insingizi, Boksburg",
    "Insingizi",
  ],
};

const JHB_SUBURBS = (johannesburgAreas.suburbs || []).map((s) => String(s).toLowerCase());
const JHB_EXCLUDE = (johannesburgAreas.excludeNames || []).map((s) => String(s).toLowerCase());

function expandPostalCodes(data) {
  const set = new Set();
  for (const code of data.extraPostalCodes || []) {
    set.add(String(code).padStart(4, "0"));
  }
  for (const range of data.postalCodeRanges || []) {
    const [start, end] = range;
    for (let n = Number(start); n <= Number(end); n += 1) {
      set.add(String(n).padStart(4, "0"));
    }
  }
  for (const code of data.postalCodes || []) {
    set.add(String(code).padStart(4, "0"));
  }
  return set;
}

const JHB_POSTAL_SET = expandPostalCodes(johannesburgAreas);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPostalCodes(text) {
  const matches = String(text || "").match(/\b\d{4}\b/g) || [];
  return matches.map((m) => m.padStart(4, "0"));
}

function hasExcludedArea(text) {
  const n = normalizeText(text);
  return JHB_EXCLUDE.some((name) => n.includes(name));
}

export function matchesJohannesburgSuburb(text) {
  const n = normalizeText(text);
  if (!n) return false;
  return JHB_SUBURBS.some((suburb) => {
    if (suburb.length < 4) {
      return new RegExp(`\\b${suburb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n);
    }
    return n.includes(suburb);
  });
}

export function matchesJohannesburgPostal(text) {
  return extractPostalCodes(text).some((code) => JHB_POSTAL_SET.has(code));
}

function matchesJohannesburgKeyword(text) {
  const n = normalizeText(text);
  return (
    n.includes("johannesburg") ||
    /\bjhb\b/.test(n) ||
    n.includes("joburg") ||
    n.includes("city of johannesburg") ||
    /\bcoj\b/.test(n)
  );
}

export function isDepotLocation(locationText, depotConfig = DEFAULT_DEPOT_AREAS) {
  return isInTargetArea(locationText, depotConfig || DEFAULT_DEPOT_AREAS);
}

/**
 * Classify a Webfleet location string.
 * Priority: depot (Boksburg HFR) first, then Johannesburg metro.
 * Returns: "depot" | "johannesburg" | "other"
 */
export function classifyLocation(locationText, depotConfig = DEFAULT_DEPOT_AREAS) {
  const text = String(locationText || "").trim();
  if (!text) return "other";

  if (isDepotLocation(text, depotConfig)) return "depot";

  // Depot-site leftovers (Windmill Park / Salfin / HFR) must never fall into yellow.
  if (hasExcludedArea(text)) return "other";

  const postalHit = matchesJohannesburgPostal(text);
  const suburbHit = matchesJohannesburgSuburb(text);
  const keywordHit = matchesJohannesburgKeyword(text);

  if (postalHit || keywordHit || suburbHit) return "johannesburg";

  return "other";
}

export function getJohannesburgCoverageSummary() {
  return {
    suburbCount: JHB_SUBURBS.length,
    postalCodeCount: JHB_POSTAL_SET.size,
    source: "johannesburgAreas.json",
  };
}

export { DEFAULT_DEPOT_AREAS, JHB_POSTAL_SET };
