import { describe, expect, it } from "vitest";
import { contentChange, textSimilarity } from "./textsim.js";

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
