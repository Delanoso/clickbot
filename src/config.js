import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
  }
  if (
    typeof base !== "object" ||
    base === null ||
    typeof override !== "object" ||
    override === null
  ) {
    return override === undefined ? base : override;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge(base[key], value);
  }
  return result;
}

export function loadConfig() {
  const defaultPath = join(root, "config", "default.json");
  const localPath = join(root, "config", "local.json");

  let config = loadJson(defaultPath);
  if (existsSync(localPath)) {
    config = deepMerge(config, loadJson(localPath));
  }

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const dispatch = config.apps?.dispatch;
  const fleet = config.apps?.fleet;
  const missing = [];

  if (!dispatch?.url || dispatch.url.includes("example.com")) {
    missing.push("apps.dispatch.url");
  }
  if (!fleet?.url || fleet.url.includes("example.com")) {
    missing.push("apps.fleet.url");
  }

  for (const key of ["truckNumber", "driverNameInput"]) {
    if (!dispatch?.selectors?.[key]) {
      missing.push(`apps.dispatch.selectors.${key}`);
    }
  }
  for (const key of ["searchInput", "driverNameResult"]) {
    if (!fleet?.selectors?.[key]) {
      missing.push(`apps.fleet.selectors.${key}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      [
        "Config is incomplete. Copy config/local.example.json to config/local.json",
        "and fill in your real URLs and selectors.",
        "",
        "Missing or placeholder values:",
        ...missing.map((item) => `  - ${item}`),
      ].join("\n")
    );
  }
}
