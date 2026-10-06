import { roundRatio } from "./money.js";

export function markupCents(base, materials, markup) {
  if (!markup.enabled) return 0;
  return roundRatio(
    BigInt(markup.scope === "materials" ? materials : base) *
      BigInt(markup.basisPoints),
    10000,
  );
}
