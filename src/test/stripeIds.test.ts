import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUBSCRIPTION_TIERS } from "@/hooks/useSubscription";

/**
 * The Stripe price and product ids, which live in three files at once.
 *
 * `useSubscription.ts` holds both for display, `create-checkout` hardcodes the
 * price ids it bills against, and `check-subscription` maps product ids back to
 * a tier name. Nothing connects them — the client is TypeScript, the functions
 * are Deno, and there is no shared module — so they can drift silently.
 *
 * The consequences are asymmetric and all bad: a price id that diverges bills a
 * different amount from the one on the Pricing page, and a product id that
 * diverges leaves a paying subscriber reading as free-tier forever, because
 * check-subscription would not recognise what they bought.
 */

const REPO_ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf8");

const createCheckout = read("supabase/functions/create-checkout/index.ts");
const checkSubscription = read("supabase/functions/check-subscription/index.ts");

describe("price ids", () => {
  it("match between the pricing page and what create-checkout bills", () => {
    for (const [tier, config] of Object.entries(SUBSCRIPTION_TIERS)) {
      expect(
        createCheckout.includes(config.priceId),
        `create-checkout does not bill ${config.priceId} for the ${tier} tier. ` +
          `The Pricing page would show one amount and Stripe would charge another.`,
      ).toBe(true);
    }
  });

  it("are distinct, so the two plans cannot bill the same amount", () => {
    const ids = Object.values(SUBSCRIPTION_TIERS).map((config) => config.priceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("look like Stripe price ids rather than placeholders", () => {
    for (const config of Object.values(SUBSCRIPTION_TIERS)) {
      expect(config.priceId).toMatch(/^price_[A-Za-z0-9]+$/);
    }
  });
});

describe("product ids", () => {
  it("match between the pricing page and what check-subscription recognises", () => {
    // A product id only check-subscription knows about, or only the client
    // knows about, means a real subscriber resolves to no tier at all.
    for (const [tier, config] of Object.entries(SUBSCRIPTION_TIERS)) {
      expect(
        checkSubscription.includes(config.productId),
        `check-subscription does not map ${config.productId} to a tier, so a ` +
          `${tier} subscriber would read as unsubscribed.`,
      ).toBe(true);
    }
  });

  it("are distinct, so the two plans cannot resolve to one tier", () => {
    const ids = Object.values(SUBSCRIPTION_TIERS).map((config) => config.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cover every product check-subscription maps", () => {
    // The reverse direction: a product id in the function that the client does
    // not know is a plan nothing on the Pricing page can sell.
    const inFunction = [...checkSubscription.matchAll(/"(prod_[A-Za-z0-9]+)"/g)].map(
      (match) => match[1],
    );
    const known = Object.values(SUBSCRIPTION_TIERS).map((config) => config.productId);

    expect([...new Set(inFunction)].sort()).toEqual([...known].sort());
  });
});

describe("the tiers themselves", () => {
  it("offers exactly the two plans the rest of the app assumes", () => {
    expect(Object.keys(SUBSCRIPTION_TIERS).sort()).toEqual(["allin", "standard"]);
  });

  it("prices all-in above standard", () => {
    expect(SUBSCRIPTION_TIERS.allin.price).toBeGreaterThan(SUBSCRIPTION_TIERS.standard.price);
  });
});
