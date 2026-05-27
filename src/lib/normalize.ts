/**
 * Normalization layer — the evasion-resistance foundation.
 *
 * Real abuse is obfuscated: invisible characters, homoglyphs (Cyrillic/Greek look-alikes),
 * fullwidth/compatibility forms. Naive string matching is trivially bypassed by all of
 * these. Everything in Tripwire that compares or matches text runs through here first, so
 * an attacker can't slip a payload past us with a zero-width space or a Cyrillic 'a'.
 *
 * Invisible/control characters are matched by numeric code point (not regex literals) so
 * the source stays pure ASCII and the checks are linear-time and ReDoS-free.
 */

// Zero-width space/non-joiner/joiner, word-joiner, BOM, soft hyphen, Arabic letter mark,
// Mongolian vowel separator.
const INVISIBLE_CODEPOINTS = new Set<number>([
    0x00ad, 0x061c, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff,
]);

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
    return INVISIBLE_CODEPOINTS.has(cp) || isControl(cp);
}

/**
 * High-frequency confusables -> their Latin base. NFKC does NOT fold these (they're
 * distinct scripts), so this map covers the homoglyph attacks actually seen in the wild
 * (paypal -> "pаypаl" with Cyrillic a). Not exhaustive -- targeted at the common abuse set.
 */
const CONFUSABLES: Record<string, string> = {
    // Cyrillic -> Latin
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c",
    "у": "y", "х": "x", "ѕ": "s", "і": "i", "ј": "j",
    "в": "b", "к": "k", "м": "m", "н": "h", "т": "t",
    "ԁ": "d", "ɡ": "g", "ո": "n", "ѵ": "v",
    // Greek -> Latin
    "α": "a", "ο": "o", "ρ": "p", "ε": "e", "ν": "v",
    "τ": "t", "κ": "k", "ι": "i", "υ": "u", "χ": "x",
    // Latin small-cap / styled forms NFKC may miss
    "ʟ": "l", "ɪ": "i",
};

const CONFUSABLE_CHARS = new Set(Object.keys(CONFUSABLES));

/** Remove invisible and control characters. */
export function stripInvisible(input: string): string {
    let out = "";
    for (const ch of input) {
        const cp = ch.codePointAt(0) ?? 0;
        if (!isInvisible(cp)) out += ch;
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
 * De-obfuscate while preserving case and spacing: NFKC -> strip invisibles -> fold
 * confusables. Use this for pattern matching where case matters (e.g. base58 crypto
 * addresses) but you still want homoglyph/zero-width evasion neutralized.
 */
export function stripAndFold(input: string | undefined | null): string {
    if (!input) return "";
    return foldConfusables(stripInvisible(input.normalize("NFKC")));
}

/**
 * Canonical form for matching/comparison: NFKC (folds fullwidth/compatibility forms) ->
 * strip invisibles -> fold confusables -> lowercase -> collapse whitespace.
 */
export function normalizeForMatch(input: string | undefined | null): string {
    if (!input) return "";
    const nfkc = input.normalize("NFKC");
    const visible = stripInvisible(nfkc);
    const folded = foldConfusables(visible);
    return folded.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True if the text contains invisible/control characters (an obfuscation signal). */
export function containsInvisible(input: string | undefined | null): boolean {
    if (!input) return false;
    for (const ch of input) {
        if (isInvisible(ch.codePointAt(0) ?? 0)) return true;
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
