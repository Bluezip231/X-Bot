import { test } from "node:test";
import assert from "node:assert/strict";
import { startOfDayInTimeZone } from "../src/utils/time.js";

test("UTC: floors to UTC midnight", () => {
  const now = new Date("2026-06-04T01:30:00Z");
  const start = startOfDayInTimeZone("UTC", now);
  assert.equal(start.toISOString(), "2026-06-04T00:00:00.000Z");
});

test("east-of-UTC zone (Asia/Tokyo, +9, no DST)", () => {
  // 01:00Z is 10:00 the same day in Tokyo; local midnight was 15:00Z prior day.
  const now = new Date("2026-06-04T01:00:00Z");
  const start = startOfDayInTimeZone("Asia/Tokyo", now);
  assert.equal(start.toISOString(), "2026-06-03T15:00:00.000Z");
});

test("west-of-UTC zone: boundary is later than UTC midnight", () => {
  // 02:00Z is the previous evening in New York, so its local day started the
  // previous calendar day (in UTC terms, after the prior UTC midnight).
  const now = new Date("2026-06-04T02:00:00Z");
  const start = startOfDayInTimeZone("America/New_York", now);
  assert.ok(start.getTime() < now.getTime());
  assert.equal(start.toISOString(), "2026-06-03T04:00:00.000Z"); // EDT = UTC-4
});

test("result is never in the future", () => {
  const now = new Date("2026-06-04T12:00:00Z");
  for (const tz of ["UTC", "Asia/Tokyo", "America/New_York", "Europe/London"]) {
    assert.ok(startOfDayInTimeZone(tz, now).getTime() <= now.getTime());
  }
});

test("invalid timezone falls back to UTC midnight", () => {
  const now = new Date("2026-06-04T08:15:00Z");
  const start = startOfDayInTimeZone("Not/AZone", now);
  assert.equal(start.toISOString(), "2026-06-04T00:00:00.000Z");
});
