/** Raise an error that carries a machine-readable code. */
export function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}
