import {
  cleanDriverName,
  resolveDriverName,
  shouldForceDefaultDriver,
} from "./driverName.js";

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

const fromList = cleanDriverName("TH2239 - Phillip Mofokeng");
assert(fromList === "Phillip Mofokeng", "should strip vehicle id prefix");

const withPhones = cleanDriverName("Sipha Khanyi 083 879 3215 / 063 735 0503");
assert(withPhones === "Sipha Khanyi", `should strip phones, got: ${withPhones}`);

assert(shouldForceDefaultDriver("H2161 - Sold") === true, "sold should force default");
assert(shouldForceDefaultDriver("LDV1801") === true, "LDV should be skipped");
assert(shouldForceDefaultDriver("Demo 95") === false, "demo must NOT be skipped");
assert(shouldForceDefaultDriver("H2100 Accident") === true, "accident should force default");
assert(shouldForceDefaultDriver("H2325") === false, "normal truck should look up");

console.log("driverName tests passed");
