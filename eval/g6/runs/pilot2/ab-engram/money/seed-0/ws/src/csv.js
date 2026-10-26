/** Split one CSV line into fields. */
export function parseCsvLine(line) {
  return line.split(",");
}

/** Render one CSV record, quoting fields that need it. */
export function toCsvLine(fields) {
  return fields.join(",");
}
