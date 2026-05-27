import { describe, expect, it } from "vitest";
import { analyzeChange, contentChange, textSimilarity } from "./textsim.js";

describe("textSimilarity", () => {
    it("is 1.0 for identical content", () => {
        expect(textSimilarity("the quick brown fox", "the quick brown fox")).toBe(1);
    });
    it("is high for a tiny edit on a long body", () => {
        const a = "the quick brown fox jumps over the lazy dog every single morning without fail";
        const b = "the quick brown fox jumps over the lazy dog every single evening without fail";
        expect(textSimilarity(a, b)).toBeGreaterThan(0.7);
    });
    it("is low for completely different content", () => {
        expect(textSimilarity("alpha beta gamma delta", "totally unrelated words here now")).toBeLessThan(0.2);
    });
    it("ignores invisible characters and case", () => {
        const zwsp = String.fromCharCode(0x200b);
        expect(textSimilarity("Hello World Foo", `hello${zwsp} world foo`)).toBe(1);
    });
});

describe("contentChange", () => {
    it("is the complement of similarity", () => {
        expect(contentChange("same words here", "same words here")).toBe(0);
        expect(contentChange("alpha beta gamma", "nothing alike at all")).toBeGreaterThan(0.8);
    });
});

describe("analyzeChange — asymmetric added/removed fraction (anti-dilution)", () => {
    it("identical content: zero added, zero removed", () => {
        const r = analyzeChange("hello world", "hello world");
        expect(r.addedFraction).toBe(0);
        expect(r.removedFraction).toBe(0);
    });
    it("pure append: high addedFraction, zero removedFraction (no dilution)", () => {
        const orig = "thank you so much for the help";
        const padded = `${orig} dm me on telegram for more deals`;
        const r = analyzeChange(orig, padded);
        expect(r.addedFraction).toBeGreaterThan(0.4);
        expect(r.removedFraction).toBe(0);
    });
    it("filler-dilution attack: symmetric similarity stays high but addedFraction exposes it", () => {
        // Attacker keeps the approved body word-for-word and pads with many distinct filler words.
        const orig = "great post and helpful info";
        const padding =
            "additionally numerous diverse extra contextual sentences padding plenty more buffer words here";
        const attack = `${orig} ${padding} check bit.ly/x`;
        const r = analyzeChange(orig, attack);
        expect(r.similarity).toBeGreaterThan(0.1); // symmetric is partly preserved
        expect(r.addedFraction).toBeGreaterThan(0.6); // added-fraction exposes the attack
    });
    it("clean rewrite: high in both", () => {
        const r = analyzeChange("one two three four five", "alpha beta gamma delta epsilon");
        expect(r.addedFraction).toBeGreaterThan(0.8);
        expect(r.removedFraction).toBeGreaterThan(0.8);
    });
});
