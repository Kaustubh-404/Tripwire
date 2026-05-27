import { describe, expect, it } from "vitest";
import {
    containsBidi,
    containsConfusable,
    containsInvisible,
    foldConfusables,
    mixedScript,
    normalizeForMatch,
    stripInvisible,
} from "./normalize.js";

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

describe("Trojan-Source / bidi controls", () => {
    const RLO = String.fromCharCode(0x202e);
    const LRI = String.fromCharCode(0x2066);
    it("strips bidi formatting from the match string", () => {
        expect(normalizeForMatch(`admin${RLO}nimda`)).toBe("adminnimda");
    });
    it("flags bidi controls as a signal", () => {
        expect(containsBidi(`ok ${LRI} text`)).toBe(true);
        expect(containsBidi("plain text")).toBe(false);
    });
});

describe("Tag characters (invisible ASCII smuggling)", () => {
    it("strips tag characters U+E0000..U+E007F", () => {
        const tagA = String.fromCodePoint(0xe0061); // tag 'a'
        expect(normalizeForMatch(`hi${tagA}there`)).toBe("hithere");
    });
});

describe("Combining marks / Zalgo", () => {
    it("strips combining marks from the match string", () => {
        const zalgo = "p" + "a" + "́" + "ypal"; // 'á' as a + combining acute
        expect(normalizeForMatch(zalgo)).toBe("paypal");
    });
});

describe("foldConfusables — extended coverage", () => {
    it("folds Armenian and Cherokee look-alikes", () => {
        expect(foldConfusables("օps")).toBe("ops"); // Armenian o
        expect(foldConfusables("Ꭺpple")).toBe("apple"); // Cherokee A
    });
    it("folds look-alike full-stop characters used to spoof domains", () => {
        expect(foldConfusables("paypal。com")).toBe("paypal.com"); // ideographic full stop
    });
});

describe("mixedScript — single-token Latin + confusable script", () => {
    it("flags a token mixing ASCII Latin with Cyrillic", () => {
        // 'p' (Latin) + 'а' (Cyrillic) + 'ypal' — the textbook spoof
        expect(mixedScript("pаypal")).toBe("Cyrillic");
    });
    it("flags Latin + Greek", () => {
        expect(mixedScript("kατα")).toBe("Greek");
    });
    it("does not flag a single-script token", () => {
        expect(mixedScript("paypal")).toBe("");
        expect(mixedScript("παγαλ")).toBe(""); // all Greek
    });
});
