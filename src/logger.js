// Minimal timestamped console logger.
//
// Accepts BOTH calling styles:
//   - message-first:      logger.info("message", extra)
//   - pino-style object:  logger.info({ ctx: 1 }, "message")
// The ported news pipeline uses the object-first style; we reorder it to print
// "message {json}" so both styles read cleanly. debug() is gated on DEBUG /
// LOG_LEVEL so it stays quiet in production.

function ts() {
  return new Date().toISOString();
}

const DEBUG_ENABLED =
  (!!process.env.DEBUG && process.env.DEBUG.toLowerCase() !== "false") ||
  ["debug", "trace"].includes((process.env.LOG_LEVEL || "").toLowerCase());

// Reorder a pino-style (contextObject, message) call into "message {json}".
function format(args) {
  const [first, second] = args;
  const isContextObject =
    first !== null &&
    typeof first === "object" &&
    !Array.isArray(first) &&
    !(first instanceof Error);

  if (isContextObject && typeof second === "string") {
    let ctx;
    try {
      ctx = JSON.stringify(first);
    } catch {
      ctx = first; // circular ref etc. — let console inspect it
    }
    return [second, ctx, ...args.slice(2)];
  }
  return args;
}

export const logger = {
  info(...args) {
    console.log(`[${ts()}] [info]`, ...format(args));
  },
  warn(...args) {
    console.warn(`[${ts()}] [warn]`, ...format(args));
  },
  error(...args) {
    console.error(`[${ts()}] [error]`, ...format(args));
  },
  debug(...args) {
    if (!DEBUG_ENABLED) return;
    console.log(`[${ts()}] [debug]`, ...format(args));
  },
};
