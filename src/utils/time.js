// Small timezone helpers. Pure (no config import) so they're easy to unit-test.

/**
 * The offset, in milliseconds, between `timeZone`'s wall-clock and UTC at the
 * given instant. East of UTC is positive (e.g. Asia/Tokyo → +9h).
 */
function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(date)) p[type] = value;
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return asUTC - date.getTime();
}

/**
 * The UTC instant corresponding to the most recent local midnight in
 * `timeZone`. Used as the day boundary for the daily post counter so "today"
 * tracks the audience's clock rather than UTC. Falls back to UTC midnight if
 * the timezone is invalid/unavailable.
 */
export function startOfDayInTimeZone(timeZone, now = new Date()) {
  try {
    const offsetMs = tzOffsetMs(now, timeZone);
    // Shift into local wall-clock time, floor to midnight, shift back to UTC.
    const local = new Date(now.getTime() + offsetMs);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - offsetMs);
  } catch {
    const utc = new Date(now.getTime());
    utc.setUTCHours(0, 0, 0, 0);
    return utc;
  }
}
