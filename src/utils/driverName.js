/**
 * Normalize and validate a driver name copied from the fleet app.
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

  const name = String(rawName).replace(/\s+/g, " ").trim();

  if (!name) {
    return { name: fallback, usedFallback: true, reason: "empty" };
  }

  if (invalid.has(name.toLowerCase())) {
    return { name: fallback, usedFallback: true, reason: "invalid" };
  }

  if (name.length < minLength) {
    return { name: fallback, usedFallback: true, reason: "too_short" };
  }

  return { name, usedFallback: false, reason: null };
}
