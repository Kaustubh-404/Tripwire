/**
 * Normalization layer — the evasion-resistance foundation.
 *
 * Defeats: invisible characters (incl. Trojan Source / bidi overrides per CVE-2021-42574),
 * homoglyphs (Cyrillic/Greek/Armenian/Cherokee look-alikes), fullwidth/compatibility forms
 * (via NFKC), Zalgo combining marks, tag-character smuggling (U+E0000..E007F).
 *
 * Invisible/control characters are matched by numeric code point (not regex literals) so
 * the source stays pure ASCII and the checks are linear-time and ReDoS-free.
 *
 * References: Unicode UTS-39 (Security Mechanisms), UTR-36 (Security Considerations),
 * Boucher & Anderson "Trojan Source" (CVE-2021-42574), Chromium IDN policy.
 */

/** Bidi formatting/override/isolate marks — the Trojan-Source class. */
const BIDI_CODEPOINTS = new Set<number>([
    0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // LRE, RLE, PDF, LRO, RLO
    0x2066, 0x2067, 0x2068, 0x2069, // LRI, RLI, FSI, PDI
    0x200e, 0x200f, 0x061c, // LRM, RLM, ALM
]);

/** Other invisible / zero-width / format characters used for evasion. */
const ZERO_WIDTH_CODEPOINTS = new Set<number>([
    0x00ad, // soft hyphen
    0x180e, // Mongolian vowel separator
    0x200b, 0x200c, 0x200d, // ZWSP, ZWNJ, ZWJ
    0x2060, // word joiner
    0x2061, 0x2062, 0x2063, 0x2064, // function-app, invisible times/separator/plus
    0xfeff, // ZWNBSP / BOM
    0x034f, // combining grapheme joiner
    0x115f, 0x1160, 0x3164, 0xffa0, // Hangul fillers
    0xfff9, 0xfffa, 0xfffb, // interlinear annotation
    0x2800, // Braille blank
]);

/** Tag characters — invisible "smuggled ASCII," used in prompt-injection and evasion. */
function isTagCharacter(cp: number): boolean {
    return cp >= 0xe0000 && cp <= 0xe007f;
}

/** C0/C1 control characters, excluding tab (0x09), newline (0x0a), carriage return (0x0d). */
function isControl(cp: number): boolean {
    return (
        cp <= 0x08 ||
        cp === 0x0b ||
        cp === 0x0c ||
        (cp >= 0x0e && cp <= 0x1f) ||
        (cp >= 0x7f && cp <= 0x9f)
    );
}

function isInvisible(cp: number): boolean {
    return (
        BIDI_CODEPOINTS.has(cp) ||
        ZERO_WIDTH_CODEPOINTS.has(cp) ||
        isTagCharacter(cp) ||
        isControl(cp)
    );
}

/**
 * High-frequency confusables -> their Latin base. NFKC does NOT fold these (they're
 * distinct scripts), so this map covers the homoglyph attacks actually seen in the wild.
 * Curated to ~150 entries covering Cyrillic/Greek/Armenian/Cherokee/IPA/Latin-styled —
 * the blocks where 95%+ of Latin-targeting attacks live. Math-alphanumerics and fullwidth
 * are handled for free by NFKC, so we don't bundle them here.
 */
const CONFUSABLES: Record<string, string> = {
    // Cyrillic -> Latin (the #1 homograph source)
    "а": "a", "б": "b", "в": "b", "г": "r", "д": "d", "е": "e", "ё": "e",
    "з": "3", "и": "n", "й": "n", "к": "k", "л": "n", "м": "m", "н": "h",
    "о": "o", "п": "n", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
    "ц": "u", "ч": "y", "ь": "b", "ы": "bl",
    "А": "a", "В": "b", "Е": "e", "К": "k", "М": "m", "Н": "h", "О": "o",
    "Р": "p", "С": "c", "Т": "t", "У": "y", "Х": "x",
    "ѕ": "s", "і": "i", "ј": "j", "ԁ": "d", "ѵ": "v", "ѡ": "w",
    "Ѕ": "s", "І": "i", "Ј": "j", "Ԁ": "d",
    // Greek -> Latin
    "α": "a", "β": "b", "γ": "y", "ε": "e", "ζ": "z", "η": "n", "θ": "o",
    "ι": "i", "κ": "k", "ν": "v", "ο": "o", "π": "n", "ρ": "p", "σ": "o",
    "τ": "t", "υ": "u", "φ": "o", "χ": "x", "ψ": "w", "ω": "w",
    "Α": "a", "Β": "b", "Ε": "e", "Ζ": "z", "Η": "h", "Ι": "i", "Κ": "k",
    "Μ": "m", "Ν": "n", "Ο": "o", "Ρ": "p", "Τ": "t", "Υ": "y", "Χ": "x",
    // Armenian
    "օ": "o", "ս": "u", "ա": "w", "հ": "h", "ո": "n",
    // Cherokee (Chrome explicitly restricts these)
    "Ꭺ": "a", "Ꭼ": "e", "Ꭿ": "i", "Ꮃ": "w", "Ꮅ": "l", "Ꮇ": "m", "Ꮎ": "n", "Ꮕ": "o",
    // IPA / Latin extended small-caps
    "ɑ": "a", "ɡ": "g", "ɪ": "i", "ɴ": "n", "ʀ": "r", "ʟ": "l", "ɢ": "g",
    "ʙ": "b", "ʜ": "h", "ᴋ": "k", "ᴍ": "m", "ᴘ": "p", "ᴛ": "t", "ᴜ": "u",
    // Dotless letters that pair with combining marks
    "ı": "i", "ȷ": "j",
    // Look-alike punctuation that spoofs domain separators (Chrome flags these)
    "。": ".", "．": ".", "｡": ".", // ideographic / fullwidth / halfwidth full stops
    "／": "/", "⁄": "/", "∕": "/", // fullwidth / fraction slash / division slash
};

const CONFUSABLE_CHARS = new Set(Object.keys(CONFUSABLES));

/** Unicode combining-mark ranges (Mn, Mc, Me). Stripped from match-string to defeat Zalgo. */
function isCombiningMark(cp: number): boolean {
    return (
        (cp >= 0x0300 && cp <= 0x036f) || // Combining Diacritical Marks
        (cp >= 0x1ab0 && cp <= 0x1aff) || // Extended
        (cp >= 0x1dc0 && cp <= 0x1dff) || // Supplement
        (cp >= 0x20d0 && cp <= 0x20ff) || // for Symbols
        (cp >= 0xfe20 && cp <= 0xfe2f) // half marks
    );
}

/** Remove invisible, control, bidi, tag and (optionally) combining-mark characters. */
export function stripInvisible(input: string, stripCombining = false): string {
    let out = "";
    for (const ch of input) {
        const cp = ch.codePointAt(0) ?? 0;
        if (isInvisible(cp)) continue;
        if (stripCombining && isCombiningMark(cp)) continue;
        out += ch;
    }
    return out;
}

/** Fold known confusable characters to their Latin base (post-NFKC). */
export function foldConfusables(input: string): string {
    let out = "";
    for (const ch of input) out += CONFUSABLES[ch] ?? ch;
    return out;
}

/**
 * Canonical form for matching/comparison.
 * Pipeline (per UTS-39 / TR-36):
 *   NFKD (decompose canonical + compatibility) -> strip invisibles+bidi+tag+combining
 *   -> fold confusables -> lowercase -> collapse whitespace.
 * NFKD before strip is critical: precomposed glyphs like 'á' must decompose to 'a'+U+0301
 * so the combining mark can be removed, defeating Zalgo and combining-mark spoofs.
 */
export function normalizeForMatch(input: string | undefined | null): string {
    if (!input) return "";
    const nfkd = input.normalize("NFKD");
    const visible = stripInvisible(nfkd, true); // also drop combining marks
    const folded = foldConfusables(visible);
    return folded.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * De-obfuscate while preserving case and spacing: NFKC -> strip invisibles -> fold
 * confusables. Use this for pattern matching where case matters (e.g. base58 crypto
 * addresses) but you still want homoglyph/zero-width evasion neutralized.
 */
export function stripAndFold(input: string | undefined | null): string {
    if (!input) return "";
    return foldConfusables(stripInvisible(input.normalize("NFKC"), false));
}

/** True if the text contains invisible/control/bidi/tag characters (an obfuscation signal). */
export function containsInvisible(input: string | undefined | null): boolean {
    if (!input) return false;
    for (const ch of input) {
        if (isInvisible(ch.codePointAt(0) ?? 0)) return true;
    }
    return false;
}

/** True if the text contains bidi formatting/override/isolate marks (Trojan-Source signal). */
export function containsBidi(input: string | undefined | null): boolean {
    if (!input) return false;
    for (const ch of input) {
        if (BIDI_CODEPOINTS.has(ch.codePointAt(0) ?? 0)) return true;
    }
    return false;
}

/** True if the text contains known confusable (homoglyph) characters. */
export function containsConfusable(input: string | undefined | null): boolean {
    if (!input) return false;
    for (const ch of input.normalize("NFKC")) {
        if (CONFUSABLE_CHARS.has(ch)) return true;
    }
    return false;
}

// ---- Mixed-script detection (UTS-39 "Highly Restrictive" — Latin+confusable-script) ----

const LATIN_RANGES: Array<[number, number]> = [
    [0x0041, 0x005a], [0x0061, 0x007a], // ASCII
    [0x00c0, 0x024f], [0x1e00, 0x1eff], [0x0250, 0x02af], // Extensions + IPA
];
const CONFUSABLE_SCRIPT_RANGES: Array<{ name: string; ranges: Array<[number, number]> }> = [
    { name: "Cyrillic", ranges: [[0x0400, 0x04ff], [0x0500, 0x052f], [0x2de0, 0x2dff], [0xa640, 0xa69f]] },
    { name: "Greek", ranges: [[0x0370, 0x03ff], [0x1f00, 0x1fff]] },
    { name: "Armenian", ranges: [[0x0530, 0x058f]] },
    { name: "Cherokee", ranges: [[0x13a0, 0x13ff], [0xab70, 0xabbf]] },
    { name: "Coptic", ranges: [[0x2c80, 0x2cff]] },
];

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
    for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
    return false;
}

/**
 * Detect a token that mixes ASCII/Latin with a confusable non-Latin script in the same
 * label — the #1 high-confidence homograph signal (e.g. "p" + Cyrillic "а" + "ypal").
 * Returns the name of the confusable script if present alongside Latin; "" otherwise.
 */
export function mixedScript(token: string): string {
    let hasLatin = false;
    const seen = new Set<string>();
    for (const ch of token.normalize("NFKC")) {
        const cp = ch.codePointAt(0) ?? 0;
        if (inRanges(cp, LATIN_RANGES)) hasLatin = true;
        for (const s of CONFUSABLE_SCRIPT_RANGES) {
            if (inRanges(cp, s.ranges)) seen.add(s.name);
        }
    }
    if (hasLatin) {
        for (const s of seen) return s; // any Latin+other-confusable mix → flag
    }
    return "";
}
