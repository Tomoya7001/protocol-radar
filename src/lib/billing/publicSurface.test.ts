import { describe, it, expect } from "vitest";
import { BILLING_PUBLIC_ENV, isBillingSurfacePublic } from "./publicSurface";

/**
 * Getting this wrong in the permissive direction publishes a storefront on a plan whose terms
 * forbid commerce, and the documented penalty is an account-wide pause — every project down,
 * not just this one. So the gate must fail closed on anything ambiguous.
 */
describe("isBillingSurfacePublic", () => {
  it("opens only on exactly \"1\"", () => {
    expect(isBillingSurfacePublic({ [BILLING_PUBLIC_ENV]: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("fails closed on unset, empty, and near-miss values", () => {
    for (const value of [undefined, "", "0", "true", "yes", "TRUE", " 1", "1 "]) {
      const env = (value === undefined ? {} : { [BILLING_PUBLIC_ENV]: value }) as NodeJS.ProcessEnv;
      expect(isBillingSurfacePublic(env)).toBe(false);
    }
  });
});
