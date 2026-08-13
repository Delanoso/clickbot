import {
  classifyLastCommunicated,
  lastCommunicatedComment,
  parseDeviceNumber,
  parseLastCommunicated,
} from "./lastCommunicated.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(parseDeviceNumber("MBV 332 GP MV024590 8 Jul 2026") === "MV024590", "should extract MV device");
assert(parseDeviceNumber("QM004563 Browse") === "QM004563", "should extract QM device");
assert(parseDeviceNumber("no device here") === "", "missing device should be empty");

const dated = parseLastCommunicated("8 Jul 2026, 11:05:02");
assert(dated.kind === "ok", "should parse Lytx last-communicated date");
assert(dated.date.getFullYear() === 2026, "year");
assert(dated.date.getMonth() === 6, "July is month 6");
assert(dated.date.getDate() === 8, "day");
assert(dated.date.getHours() === 11, "hour");

assert(parseLastCommunicated("—").kind === "missing", "em dash is missing");
assert(parseLastCommunicated("-").kind === "missing", "hyphen is missing");
assert(parseLastCommunicated("").kind === "missing", "empty is missing");
assert(parseLastCommunicated("not a date").kind === "unparsed", "garbage is unparsed");

const now = new Date(2026, 7, 13, 13, 38, 0); // 13 Aug 2026
const older = classifyLastCommunicated("8 Jul 2026, 11:05:02", { maxAgeDays: 2, now });
assert(older.stale === true, "July date should be stale in August");
assert(older.reason === "older_than_max_age", "reason should be older_than_max_age");

const recent = classifyLastCommunicated("13 Aug 2026, 10:00:00", { maxAgeDays: 2, now });
assert(recent.stale === false, "same-day communication should not be stale");
assert(recent.reason === "recent", "reason should be recent");

const justOver = classifyLastCommunicated("11 Aug 2026, 13:37:00", { maxAgeDays: 2, now });
assert(justOver.stale === true, "just over 48 hours should be stale");

const justUnder = classifyLastCommunicated("11 Aug 2026, 13:39:00", { maxAgeDays: 2, now });
assert(justUnder.stale === false, "just under 48 hours should not be stale");

const missing = classifyLastCommunicated("—", { maxAgeDays: 2, now });
assert(missing.stale === true && missing.reason === "missing", "no date should count as stale");

const unparsed = classifyLastCommunicated("tomorrow maybe", { maxAgeDays: 2, now });
assert(unparsed.stale === false && unparsed.reason === "unparsed", "unparsed dates should be skipped");

assert(
  lastCommunicatedComment("8 Jul 2026, 11:05:02") === "Last communicated: 8 Jul 2026, 11:05:02",
  "comment with date"
);
assert(lastCommunicatedComment("") === "Last communicated: none", "comment without date");

console.log("lastCommunicated tests passed");
