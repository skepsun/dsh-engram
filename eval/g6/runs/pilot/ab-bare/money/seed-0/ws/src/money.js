/** Amounts are held as integer cents; this is the scale between cents and units. */
const CENTS_PER_UNIT = 100;

/** Convert a decimal amount to integer cents, rounding to the nearest cent. */
function toCents(amount) {
  return roundHalfUp(amount * CENTS_PER_UNIT);
}

/** Convert integer cents back to a decimal amount. */
function fromCents(cents) {
  return cents / CENTS_PER_UNIT;
}

/**
 * Round to an integer, with ties rounded away from zero (half up).
 * The epsilon absorbs the representation error of binary floating point so a
 * true .5 is not rounded down when it is stored as .49999999999999994.
 */
function roundHalfUp(value) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  const floor = Math.floor(magnitude);
  return sign * (magnitude - floor >= 0.5 - 1e-9 ? floor + 1 : floor);
}

/** Sum a list of decimal amounts. Money is compared to the cent. */
export function sumAmounts(values) {
  const totalCents = values.reduce((total, value) => total + toCents(value), 0);
  return fromCents(totalCents);
}

/** Apply a percentage discount, rounded to the cent. */
export function applyDiscount(amount, percent) {
  const discounted = (toCents(amount) * (100 - percent)) / 100;
  return fromCents(roundHalfUp(discounted));
}
