/**
 * Round a value to the nearest cent, half up (ties away from zero).
 *
 * Shifting the decimal point through the string form ("1.005e2" === 100.5)
 * avoids the binary trap in `Math.round(value * 100)`, where the scaled
 * value lands a hair below the true half and the tie rounds down.
 */
function roundToCents(value) {
  if (!Number.isFinite(value)) return value;
  const shifted = Number(`${Math.abs(value)}e2`);
  // Very large magnitudes stringify with an exponent ("1e+21e2" is not a
  // number); cents are meaningless there, so fall back to plain scaling.
  if (!Number.isFinite(shifted)) return Math.round(value * 100) / 100;
  const cents = Math.round(shifted);
  return (value < 0 ? -cents : cents) / 100;
}

/** Sum a list of decimal amounts. Money is compared to the cent. */
export function sumAmounts(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return roundToCents(total);
}

/** Apply a percentage discount, rounded to the cent. */
export function applyDiscount(amount, percent) {
  return roundToCents(amount - amount * (percent / 100));
}
