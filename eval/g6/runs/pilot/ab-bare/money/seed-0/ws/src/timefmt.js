/** Render a timestamp for the audit log. */
export function formatStamp(date) {
  return date.toLocaleString("en-US");
}

/** Parse a stamp produced by formatStamp. */
export function parseStamp(text) {
  return new Date(text);
}
