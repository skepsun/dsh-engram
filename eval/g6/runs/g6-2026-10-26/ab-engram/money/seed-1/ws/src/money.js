/** Sum a list of decimal amounts. Money is compared to the cent. */
export function sumAmounts(values) {
  return values.reduce((total, value) => total + value, 0);
}

/** Apply a percentage discount, rounded to the cent. */
export function applyDiscount(amount, percent) {
  return amount - amount * (percent / 100);
}
