/**
 * Extract the full API error response from an error object.
 * Works with OpenAI SDK errors, Twitter API v2 errors, fetch Response errors,
 * and plain Error objects. Returns a string safe for storing in a TEXT column.
 */
export function serializeError(err) {
  if (!err) return null;

  const parts = {};

  // Basics
  parts.message = err.message;
  parts.name = err.name;
  if (err.code) parts.code = err.code;
  if (err.type) parts.type = err.type;

  // HTTP status (OpenAI SDK, twitter-api-v2, AxiosError, etc.)
  if (err.status) parts.status = err.status;
  if (err.statusCode) parts.statusCode = err.statusCode;
  if (err.httpStatus) parts.httpStatus = err.httpStatus;

  // OpenAI SDK: err.error contains the full API response body
  if (err.error) {
    try {
      parts.error_body = typeof err.error === "string" ? JSON.parse(err.error) : err.error;
    } catch {
      parts.error_body = err.error;
    }
  }

  // Twitter API v2: err.data contains the API response
  if (err.data) {
    parts.response_data = err.data;
  }

  // Axios-style: err.response.data
  if (err.response) {
    parts.response_status = err.response.status || err.response.statusCode;
    if (err.response.data) {
      parts.response_data = err.response.data;
    }
    if (err.response.headers) {
      // Only grab rate-limit and error-relevant headers
      const h = err.response.headers;
      const relevant = {};
      for (const key of Object.keys(h)) {
        if (key.startsWith("x-") || key.startsWith("retry") || key === "content-type") {
          relevant[key] = h[key];
        }
      }
      if (Object.keys(relevant).length > 0) parts.response_headers = relevant;
    }
  }

  // Generic: some libraries put the body on err.body
  if (err.body) {
    try {
      parts.body = typeof err.body === "string" ? JSON.parse(err.body) : err.body;
    } catch {
      parts.body = err.body;
    }
  }

  // Rate limit info (OpenAI, Twitter)
  if (err.headers) {
    const relevant = {};
    const headerObj =
      typeof err.headers.entries === "function"
        ? Object.fromEntries(err.headers.entries())
        : err.headers;
    for (const [key, val] of Object.entries(headerObj)) {
      if (key.startsWith("x-ratelimit") || key.startsWith("retry") || key === "x-request-id") {
        relevant[key] = val;
      }
    }
    if (Object.keys(relevant).length > 0) parts.rate_limit_headers = relevant;
  }

  try {
    return JSON.stringify(parts);
  } catch {
    return err.message || String(err);
  }
}
