/**
 * Normalize and validate a driver name copied from Webfleet.
 * Returns the default when the value is missing or not usable.
 */
export function resolveDriverName(rawName, config) {
  const fallback = config.defaultDriverName || "Driver Unknown";
  const invalid = new Set(
    (config.validation?.invalidNames || []).map((name) =>
      String(name).trim().toLowerCase()
    )
  );
  const minLength = config.validation?.minNameLength ?? 2;

  if (rawName == null) {
    return { name: fallback, usedFallback: true, reason: "empty" };
  }

  let name = cleanDriverName(rawName);

  if (!name) {
    return { name: fallback, usedFallback: true, reason: "empty" };
  }

  if (invalid.has(name.toLowerCase()) || isPlaceholderDriverName(name)) {
    return { name: fallback, usedFallback: true, reason: "invalid" };
  }

  if (name.length < minLength) {
    return { name: fallback, usedFallback: true, reason: "too_short" };
  }

  return { name, usedFallback: false, reason: null };
}

/**
 * Sold / LDV / accident vehicles should always use Driver Unknown
 * (no Webfleet lookup). Demo trucks are looked up normally.
 */
export function shouldForceDefaultDriver(truckNumber) {
  const value = String(truckNumber || "");
  // Demo trucks must go through Webfleet like normal vehicles.
  if (/\bdemo\b/i.test(value)) {
    return false;
  }
  return (
    /\b(sold|accident)\b/i.test(value) ||
    /^ldv/i.test(value.trim()) ||
    /\bldv\d+/i.test(value)
  );
}

/**
 * Webfleet often returns:
 * - "TH2239 - Phillip Mofokeng"
 * - "Sipha Khanyi 083 879 3215 / 063 735 0503"
 */
export function cleanDriverName(rawName) {
  let name = String(rawName).replace(/\s+/g, " ").trim();
  if (!name) return "";

  // "VEHICLE - Driver Name" / "VEHICLE – Driver Name" list format
  const dashed = name.match(/^[A-Z0-9]+(?:\s*[–—-]\s*)(.+)$/i);
  if (dashed) {
    name = dashed[1].trim();
  }

  // Strip phone numbers (keep names like "N/A" intact).
  // Handles SA local (083…), +27…, and other intl (+264…) forms.
  name = name
    .replace(/(\+\d{1,3}[\d\s\-()]{6,}\d)/g, " ")
    .replace(/(\b0\d[\d\s\-()]{6,}\d)/g, " ")
    .replace(/(\+?\d[\d\s\-()]{6,}\d)/g, " ")
    .replace(/\/{2,}/g, " ")
    .replace(/\s+\/\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return name;
}

/** Placeholders that mean "no real driver" in Webfleet. */
export function isPlaceholderDriverName(name) {
  const value = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
  return (
    !value ||
    /^(driver|no driver|none|unknown|n\/a|na|-|--)$/i.test(value)
  );
}
