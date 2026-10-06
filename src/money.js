// Fixed-point currency helpers. All arithmetic inputs are integer cents or basis points.
function fixed(value) {
  const text = String(value).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text))
    throw new Error("Enter a positive number with at most two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export const parseMoney = fixed;
export const parsePercent = fixed;
export function roundRatio(numerator, denominator) {
  const n = BigInt(numerator),
    d = BigInt(denominator);
  const result = (n + d / 2n) / d;
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("This total is too large to calculate safely.");
  return Number(result);
}
export const money = (cents) =>
  new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(
    cents / 100,
  );
