/** Round a value to a whole cent, half away from zero (half up for positives). */
function roundHalfUpCents(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Convert a decimal amount to integer cents, avoiding binary-float drift. */
function toCents(amount) {
  return roundHalfUpCents(amount * 100);
}

/** Sum a list of decimal amounts. Money is compared to the cent. */
export function sumAmounts(values) {
  const totalCents = values.reduce((total, value) => total + toCents(value), 0);
  return totalCents / 100;
}

/** Apply a percentage discount, rounded to the cent. */
export function applyDiscount(amount, percent) {
  const cents = toCents(amount);
  const discountedCents = cents - (cents * percent) / 100;
  return roundHalfUpCents(discountedCents) / 100;
}
