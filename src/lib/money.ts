export function formatMoney(amount: number, currency = "EUR", locale = "es-ES") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}
export function formatNumber(n: number, digits = 2, locale = "es-ES") {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
}
export const round2 = (n: number) => Math.round(n * 100) / 100;
