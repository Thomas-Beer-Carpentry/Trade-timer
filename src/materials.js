import { roundRatio } from "./money.js";

export function materialExclCents(material, gstBasisPoints = 1500) {
  return material.gstInclusive
    ? roundRatio(BigInt(material.amountCents) * 10000n, 10000 + gstBasisPoints)
    : material.amountCents;
}
