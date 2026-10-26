const CENTS_PER_UNIT = 100;

/**
 * Convert a decimal amount to an integer number of cents, rounding half up.
 * `toFixed` first absorbs binary float noise (19.99 * 100 is 1998.9999999999998)
 * so that values like 1.005 round to 101 cents instead of 100.
 */
function toCents(amount) {
  return Math.round(Number((amount * CENTS_PER_UNIT).toFixed(6)));
}

/** Round half up, away from zero, and never return -0. */
function roundHalfUp(value) {
  return Math.sign(value) * Math.round(Math.abs(value)) + 0;
}

/** Sum a list of decimal amounts. Money is compared to the cent. */
export function sumAmounts(values) {
  const totalCents = values.reduce((total, value) => total + toCents(value), 0);
  return totalCents / CENTS_PER_UNIT;
}

/** Apply a percentage discount, rounded to the cent. */
export function applyDiscount(amount, percent) {
  const discountedCents = toCents(amount) * (1 - percent / 100);
  return roundHalfUp(discountedCents) / CENTS_PER_UNIT;
}
