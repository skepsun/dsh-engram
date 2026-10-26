const CENTS_PER_UNIT = 100;

/**
 * Round a number to the nearest integer, with halves rounded away from zero.
 * `Math.round` rounds halves towards +Infinity, which would be the wrong
 * direction for negative half-cent amounts.
 */
function roundHalfUp(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Convert a decimal money amount to whole cents. */
function toCents(amount) {
  return roundHalfUp(amount * CENTS_PER_UNIT);
}

/** Convert whole cents back to a decimal money amount. */
function fromCents(cents) {
  // `+ 0` normalises -0 to 0 so callers never see a negative zero.
  return (cents + 0) / CENTS_PER_UNIT;
}

/** Sum a list of decimal amounts. Money is compared to the cent. */
export function sumAmounts(values) {
  let totalCents = 0;
  for (const value of values) {
    totalCents += toCents(value);
  }
  return fromCents(totalCents);
}

/** Apply a percentage discount, rounded to the cent. */
export function applyDiscount(amount, percent) {
  const amountCents = toCents(amount);
  const discountedCents = amountCents * (1 - percent / 100);
  return fromCents(roundHalfUp(discountedCents));
}
