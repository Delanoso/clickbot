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
assert(dated.kind === "ok", "should parse day-month last-communicated date");
assert(dated.date.getFullYear() === 2026, "year");
assert(dated.date.getMonth() === 6, "July is month 6");
assert(dated.date.getDate() === 8, "day");
assert(dated.date.getHours() === 11, "hour");

const us = parseLastCommunicated("Aug 13, 2026, 1:36:40 PM");
assert(us.kind === "ok", "should parse Lytx US last-communicated date");
assert(us.date.getFullYear() === 2026, "US year");
assert(us.date.getMonth() === 7, "August is month 7");
assert(us.date.getDate() === 13, "US day");
assert(us.date.getHours() === 13, "1 PM should be 13");
assert(us.date.getMinutes() === 36, "US minutes");

const midnight = parseLastCommunicated("Aug 13, 2026, 12:42:26 AM");
assert(midnight.kind === "ok" && midnight.date.getHours() === 0, "12 AM should be hour 0");

const noon = parseLastCommunicated("Jul 8, 2026, 11:05:02 AM");
assert(noon.kind === "ok" && noon.date.getHours() === 11, "11 AM should stay 11");
assert(noon.date.getMonth() === 6 && noon.date.getDate() === 8, "Jul 8 US date");

assert(parseLastCommunicated("—").kind === "missing", "em dash is missing");
assert(parseLastCommunicated("-").kind === "missing", "hyphen is missing");
assert(parseLastCommunicated("").kind === "missing", "empty is missing");
assert(parseLastCommunicated("not a date").kind === "unparsed", "garbage is unparsed");

const now = new Date(2026, 7, 13, 13, 38, 0); // 13 Aug 2026
const older = classifyLastCommunicated("8 Jul 2026, 11:05:02", { maxAgeDays: 2, now });
assert(older.stale === true, "July date should be stale in August");
assert(older.reason === "older_than_max_age", "reason should be older_than_max_age");

const recent = classifyLastCommunicated("Aug 13, 2026, 10:00:00 AM", { maxAgeDays: 2, now });
assert(recent.stale === false, "same-day communication should not be stale");
assert(recent.reason === "recent", "reason should be recent");

const liveSample = classifyLastCommunicated("Aug 4, 2026, 2:54:33 PM", { maxAgeDays: 2, now });
assert(liveSample.stale === true, "Aug 4 should be stale on Aug 13");

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
