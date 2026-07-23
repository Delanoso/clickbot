import assert from "node:assert/strict";
import {
  classifyLocation,
  matchesJohannesburgPostal,
  matchesJohannesburgSuburb,
  getJohannesburgCoverageSummary,
} from "./locationClassifier.js";

const coverage = getJohannesburgCoverageSummary();
assert.ok(coverage.suburbCount > 100, "expected a full CoJ suburb list");
assert.ok(coverage.postalCodeCount > 200, "expected expanded CoJ postal codes");

assert.equal(
  classifyLocation("HFR - Boksburg Depot, N Boundary Road, Boksburg 1459, ZA"),
  "depot"
);
assert.equal(
  classifyLocation("Windmill Park, Boksburg 1459, ZA"),
  "depot"
);

assert.equal(
  classifyLocation("Sandton City, Sandton, Johannesburg 2196, ZA"),
  "johannesburg"
);
assert.equal(classifyLocation("Rosebank, Johannesburg"), "johannesburg");
assert.equal(classifyLocation("Soweto 1868"), "johannesburg");
assert.equal(classifyLocation("Midrand 1685"), "johannesburg");
assert.equal(classifyLocation("Fourways, JHB"), "johannesburg");
assert.equal(matchesJohannesburgPostal("Somewhere 2090 ZA"), true);
assert.equal(matchesJohannesburgSuburb("Truck at Roodepoort industrial"), true);

// East Rand towns without CoJ postal should not count as Johannesburg.
assert.equal(classifyLocation("Benoni 1501, ZA"), "other");
assert.equal(classifyLocation("Germiston, Ekurhuleni"), "other");
assert.equal(classifyLocation("Kempton Park"), "other");

assert.equal(classifyLocation(""), "other");
assert.equal(classifyLocation("Durban harbour"), "other");

console.log("locationClassifier.test.js passed");
