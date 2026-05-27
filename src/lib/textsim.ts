import { normalizeForMatch } from "./normalize.js";

/**
 * Content-change measurement via word-shingle Jaccard similarity.
 *
 * Length delta is naive — swapping equal-length content reads as "no change." Shingling
 * (overlapping k-word windows) compares the actual meaning-bearing content and is robust
 * to reordering and padding, which is how integrity systems measure edits.
 */

function shingles(text: string, k: number): Set<string> {
    const tokens = normalizeForMatch(text).split(" ").filter(Boolean);
    if (tokens.length === 0) return new Set();
    if (tokens.length < k) return new Set([tokens.join(" ")]);
    const set = new Set<string>();
    for (let i = 0; i <= tokens.length - k; i++) {
        set.add(tokens.slice(i, i + k).join(" "));
    }
    return set;
}

/** Jaccard similarity of word shingles, 0..1 (1 = identical content). */
export function textSimilarity(a: string, b: string, k = 2): number {
    const A = shingles(a, k);
    const B = shingles(b, k);
    if (A.size === 0 && B.size === 0) return 1;
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const s of A) if (B.has(s)) inter++;
    const union = A.size + B.size - inter;
    return union === 0 ? 1 : inter / union;
}

/** How much meaning-bearing content changed, 0..1 (1 = completely different). */
export function contentChange(a: string, b: string): number {
    return 1 - textSimilarity(a, b);
}
