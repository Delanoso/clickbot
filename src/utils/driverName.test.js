import { resolveDriverName } from "./driverName.js";

const config = {
  defaultDriverName: "Driver Unknown",
  validation: {
    minNameLength: 2,
    invalidNames: ["", "n/a", "na", "null", "undefined", "-", "--"],
  },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const valid = resolveDriverName("  Jane Doe  ", config);
assert(valid.name === "Jane Doe", "should keep valid name");
assert(valid.usedFallback === false, "valid name should not use fallback");

const empty = resolveDriverName("   ", config);
assert(empty.name === "Driver Unknown", "empty should fall back");
assert(empty.usedFallback === true, "empty should mark fallback");

const invalid = resolveDriverName("N/A", config);
assert(invalid.name === "Driver Unknown", "N/A should fall back");

const missing = resolveDriverName(null, config);
assert(missing.name === "Driver Unknown", "null should fall back");

console.log("driverName tests passed");
