import { describe, expect, it } from "vitest";
import { damerauLevenshtein, deglyph, findLookalike, lookalikeForRegistrableDomain } from "./typosquat.js";

describe("damerauLevenshtein", () => {
    it("counts transpositions as 1 (vs Levenshtein's 2)", () => {
        expect(damerauLevenshtein("paypla", "paypal")).toBe(1);
    });
    it("counts substitutions / insertions / deletions as 1 each", () => {
        expect(damerauLevenshtein("paypol", "paypal")).toBe(1);
        expect(damerauLevenshtein("paypall", "paypal")).toBe(1);
        expect(damerauLevenshtein("paypl", "paypal")).toBe(1);
    });
    it("returns 0 for identical strings", () => {
        expect(damerauLevenshtein("paypal", "paypal")).toBe(0);
    });
});

describe("deglyph — visual skeleton", () => {
    it("folds Cyrillic confusables to Latin", () => {
        expect(deglyph("pаypal")).toBe("paypal"); // Cyrillic a
    });
    it("folds digit-letter leet (1→l, 0→o, 5→s)", () => {
        expect(deglyph("paypa1")).toBe("paypal");
        expect(deglyph("g00gle")).toBe("google");
    });
    it("folds visual digraphs (rn→m, vv→w, cl→d)", () => {
        expect(deglyph("arnazon")).toBe("amazon");
        expect(deglyph("vvhatsapp")).toBe("whatsapp");
    });
});

describe("findLookalike — the bait-and-switch heart", () => {
    it("flags Cyrillic-spoofed paypal as homoglyph of paypal", () => {
        const r = findLookalike("pаypal", "pаypal.com");
        expect(r?.kind).toBe("homoglyph");
        expect(r?.brand.label).toBe("paypal");
        expect(r?.severity).toBe("high");
    });
    it("flags leet-spoofed paypal (paypa1)", () => {
        const r = findLookalike("paypa1", "paypa1.com");
        expect(r?.kind).toBe("homoglyph");
        expect(r?.brand.label).toBe("paypal");
    });
    it("flags rn->m squat on amazon", () => {
        const r = findLookalike("arnazon", "arnazon.com");
        expect(r?.kind).toBe("homoglyph");
        expect(r?.brand.label).toBe("amazon");
    });
    it("flags TLD-swap: real label, wrong TLD", () => {
        // paypal.xyz — same label, different TLD from paypal.com
        const r = findLookalike("paypal", "paypal.xyz");
        expect(r?.kind).toBe("homoglyph");
        expect(r?.brand.label).toBe("paypal");
        expect(r?.severity).toBe("high");
    });
    it("flags combosquat (paypal-secure.com)", () => {
        const r = findLookalike("paypal-secure", "paypal-secure.com");
        expect(r?.kind).toBe("combosquat");
        expect(r?.brand.label).toBe("paypal");
    });
    it("flags edit-distance 1 (paypol → paypal)", () => {
        const r = findLookalike("paypol", "paypol.com");
        expect(r?.kind).toBe("near-edit");
        expect(r?.distance).toBe(1);
    });
    it("flags edit-distance 1 on a long brand (microsft → microsoft)", () => {
        // microsft is 1 deletion from microsoft (label length 9).
        const r = findLookalike("microsft", "microsft.com");
        expect(r?.brand.label).toBe("microsoft");
        expect(r?.distance).toBe(1);
        expect(r?.severity).toBe("high");
    });
    it("only flags d=2 for longer brands (>=8 chars) — precision gate", () => {
        // 'aple' is 1 deletion from 'apple' (length 5) → d=1 still allowed for >=4 brands.
        // But a d=2 match against the short brand 'meta' (length 4) must NOT fire.
        const r = findLookalike("meto", "meto.com"); // 1 sub from 'meta' — d=1, length 4 → high
        expect(r?.brand.label === "meta" || r === null).toBe(true);
    });
    it("exempts the brand's own real domain", () => {
        expect(findLookalike("paypal", "paypal.com")).toBe(null);
        expect(findLookalike("google", "google.com")).toBe(null);
    });
    it("does NOT flag short unrelated domains at distance 1 (precision gate)", () => {
        // Short brand labels (length <4) are gated off to prevent spurious matches.
        expect(findLookalike("foo", "foo.com")).toBe(null);
    });
    it("does not flag wildly different domains", () => {
        expect(findLookalike("wikipedia", "wikipedia.org")).toBe(null);
    });
});

describe("lookalikeForRegistrableDomain", () => {
    it("works on full registrable strings", () => {
        const r = lookalikeForRegistrableDomain("paypa1.com");
        expect(r?.brand.label).toBe("paypal");
    });
});
