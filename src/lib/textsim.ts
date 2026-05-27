import { normalizeForMatch } from "./normalize.js";

/**
 * Content-change measurement for short text — research-backed.
 *
 * We deliberately avoid SimHash (a known anti-pattern for short text — calibrated for
 * web-page-length docs at Google scale) and MinHash/LSH (pointless for pairwise approved-
 * vs-edited comparison where we have both strings in hand). Instead we use exact set
 * similarity:
 *
 *  - **Blended unigram + bigram Jaccard** so reorder-robustness (unigram set) is balanced
 *    against order-sensitivity (bigram set). Pure bigram is too brittle on short Reddit
 *    text; pure unigram is fooled by anagrams.
 *  - **Asymmetric addedFraction = |B \ A| / |B|** so a filler-padding dilution attack
 *    cannot suppress the signal — added content is measured directly, not via the union-
 *    diluted symmetric Jaccard.
 *
 * Refs: Broder 1997 (resemblance vs containment); Manku/Jain/Das Sarma 2007 (SimHash
 * calibration, why it's wrong for short text); Charikar 2002 (SimHash origin).
 */

function tokens(text: string): string[] {
    return normalizeForMatch(text).split(" ").filter(Boolean);
}

function tokenSet(text: string): Set<string> {
    return new Set(tokens(text));
}

function shingles(text: string, k: number): Set<string> {
    const t = tokens(text);
    if (t.length === 0) return new Set();
    if (t.length < k) return new Set([t.join(" ")]);
    const set = new Set<string>();
    for (let i = 0; i <= t.length - k; i++) set.add(t.slice(i, i + k).join(" "));
    return set;
}

function jaccard(A: Set<string>, B: Set<string>): number {
    if (A.size === 0 && B.size === 0) return 1;
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    const union = A.size + B.size - inter;
    return union === 0 ? 1 : inter / union;
}

function intersectionSize(A: Set<string>, B: Set<string>): number {
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter;
}

/** Blended unigram (0.5) + bigram (0.5) Jaccard. Reorder-robust + locally order-aware. */
export function textSimilarity(a: string, b: string): number {
    const u = jaccard(tokenSet(a), tokenSet(b));
    const bi = jaccard(shingles(a, 2), shingles(b, 2));
    return 0.5 * u + 0.5 * bi;
}

/** 1 - similarity. Net change magnitude. */
export function contentChange(a: string, b: string): number {
    return 1 - textSimilarity(a, b);
}

export interface ChangeProfile {
    /** Blended Jaccard, 0..1 (1 = identical content). */
    similarity: number;
    /** |B \ A| / |B|: fraction of CURRENT content that's new — dilution-resistant. */
    addedFraction: number;
    /** |A \ B| / |A|: fraction of APPROVED content that was removed. */
    removedFraction: number;
}

/**
 * Full change profile: similarity plus asymmetric added/removed-fraction measures. The
 * key signal is `addedFraction`: in a padding-dilution attack the attacker keeps the
 * approved text and appends malicious content; symmetric Jaccard barely drops, but
 * `addedFraction` rises directly with how much was tacked on, defeating that attack.
 */
export function analyzeChange(a: string, b: string): ChangeProfile {
    const A = tokenSet(a);
    const B = tokenSet(b);
    const inter = intersectionSize(A, B);
    return {
        similarity: textSimilarity(a, b),
        addedFraction: B.size === 0 ? 0 : 1 - inter / B.size,
        removedFraction: A.size === 0 ? 0 : 1 - inter / A.size,
    };
}
