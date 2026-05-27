import { describe, expect, it } from "vitest";
import { containsConfusable, containsInvisible, normalizeForMatch, stripInvisible } from "./normalize.js";

const ZWSP = String.fromCharCode(0x200b);
const SOFT_HYPHEN = String.fromCharCode(0x00ad);
const BOM = String.fromCharCode(0xfeff);

describe("normalizeForMatch — homoglyph folding", () => {
    it("folds a Cyrillic-spoofed paypal to plain latin", () => {
        // "pаypаl" uses Cyrillic а (U+0430) for the two a's.
        const spoof = "pаypаl.com";
        expect(normalizeForMatch(spoof)).toBe("paypal.com");
    });
    it("folds Greek look-alikes", () => {
        expect(normalizeForMatch("οne")).toBe("one"); // Greek omicron -> o
    });
});

describe("normalizeForMatch — invisible stripping + NFKC", () => {
    it("strips zero-width characters splitting a word", () => {
        expect(normalizeForMatch(`pay${ZWSP}pal`)).toBe("paypal");
    });
    it("strips soft hyphen and BOM", () => {
        expect(normalizeForMatch(`ev${SOFT_HYPHEN}il${BOM}`)).toBe("evil");
    });
    it("folds fullwidth (NFKC) and lowercases + collapses whitespace", () => {
        expect(normalizeForMatch("Ｐａｙｐａｌ")).toBe("paypal"); // ＰａｙｐａＬ-ish
        expect(normalizeForMatch("  HeLLo   World  ")).toBe("hello world");
    });
});

describe("stripInvisible", () => {
    it("keeps tab/newline but drops zero-width", () => {
        expect(stripInvisible(`a${ZWSP}b\tc`)).toBe("ab\tc");
    });
});

describe("containsInvisible / containsConfusable (signals)", () => {
    it("detects invisible chars", () => {
        expect(containsInvisible(`a${ZWSP}b`)).toBe(true);
        expect(containsInvisible("clean text")).toBe(false);
    });
    it("detects confusables", () => {
        expect(containsConfusable("pаypal")).toBe(true); // Cyrillic a
        expect(containsConfusable("paypal")).toBe(false);
    });
});
