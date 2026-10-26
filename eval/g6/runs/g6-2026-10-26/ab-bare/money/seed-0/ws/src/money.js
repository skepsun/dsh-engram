const CENTS_PER_UNIT = 100;

/**
 * Convert a decimal amount to whole cents, rounding halves away from zero.
 *
 * Most decimal fractions cannot be represented exactly in binary floating
 * point (for example `1.005 * 100` is `100.49999999999999`), so a small
 * relative tolerance is added before rounding to keep values that are a hair
 * below an exact half from rounding the wrong way.
 */
function toCents(value) {
  const scaled = value * CENTS_PER_UNIT;
  const tolerance = Math.max(1, Math.abs(scaled)) * Number.EPSILON;
  const cents = Math.round(scaled + Math.sign(scaled) * tolerance);
  return cents === 0 ? 0 : cents; // normalise -0
}

/** Sum a list of decimal amounts. Money is compared to the cent. */
export function sumAmounts(values) {
  const totalCents = values.reduce((total, value) => total + toCents(value), 0);
  return totalCents / CENTS_PER_UNIT;
}

/** Apply a percentage discount, rounded to the cent (half up). */
export function applyDiscount(amount, percent) {
  const discounted = amount - amount * (percent / 100);
  return toCents(discounted) / CENTS_PER_UNIT;
}
