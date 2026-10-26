const CENTS_PER_UNIT = 100;

/** Round to a whole number half up, away from zero, like cash rounding. */
function roundHalfUp(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Convert a decimal amount to whole cents, absorbing binary float noise. */
function toCents(amount) {
  return roundHalfUp(amount * CENTS_PER_UNIT);
}

/** Convert whole cents back to the decimal amount callers pass around. */
function fromCents(cents) {
  return cents / CENTS_PER_UNIT;
}

/** Sum a list of decimal amounts. Money is compared to the cent. */
export function sumAmounts(values) {
  // Add whole cents, never decimals: 10 + 20 cents is exactly 0.3, whereas
  // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
  const totalCents = values.reduce((sum, value) => sum + toCents(value), 0);
  return fromCents(totalCents);
}

/** Apply a percentage discount, rounded to the cent. */
export function applyDiscount(amount, percent) {
  const cents = toCents(amount);
  const discountedCents = cents - (cents * percent) / CENTS_PER_UNIT;
  // Round the discounted result rather than the discount itself: 5 cents at
  // 50% off is 2.5 cents, which rounds half up to 3, not to 2.
  return fromCents(roundHalfUp(discountedCents));
}
