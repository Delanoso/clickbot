export function normalizeMonitorText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function toAreaTerms(config = {}) {
  const values = [];
  if (config.targetArea) values.push(config.targetArea);
  if (Array.isArray(config.targetAreas)) values.push(...config.targetAreas);
  return values.map(normalizeMonitorText).filter(Boolean);
}

export function isInTargetArea(locationText, config = {}) {
  const normalizedLocation = normalizeMonitorText(locationText);
  if (!normalizedLocation) return false;

  const areaTerms = toAreaTerms(config);
  if (!areaTerms.length) return false;

  return areaTerms.some((term) => normalizedLocation.includes(term));
}

export function formatStatusLine(truckNumber, observation) {
  const location = observation.locationText || "(no location text)";
  return `${truckNumber}: ${location}${observation.inTargetArea ? " [IN AREA]" : ""}`;
}
