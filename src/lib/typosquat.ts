import { foldConfusables } from "./normalize.js";

/**
 * Typosquat / look-alike domain detection — deterministic, no network.
 *
 * Detects that a candidate domain is a near-miss of a known brand:
 *   omission (paypl), insertion (paypaal), substitution (paypol), transposition
 *   (paypla), repetition (paaypal), vowel-swap (peypal), visual homoglyph (pаypal
 *   Cyrillic), digit-letter swap (paypa1), digraph (rn→m), combosquat
 *   (paypal-secure.com), TLD-swap (paypal.xyz), punycode-decoded homograph.
 *
 * Algorithm: deglyph(label) → exact match to brand skeleton (HIGH), or substring
 * containment of brand label inside candidate (combosquat, HIGH), or bounded Damerau-
 * Levenshtein distance with length gating. Always exempts a candidate that exactly
 * equals the brand's real registrable domain.
 *
 * References: Damerau 1964 / Levenshtein 1966 (edit distance); dnstwist /
 * URLCrazy (typosquat permutation taxonomy); Kintis et al. CCS 2017 (combosquatting);
 * Unicode UTS-39 (confusables/skeleton).
 */

export interface Brand {
    /** The brand's second-level label (no TLD) — what attackers spoof. */
    label: string;
    /** The brand's actual registrable domain — used to exempt the real site. */
    realDomain: string;
}

/**
 * Top ~50 commonly-impersonated brands (APWG quarterly reports + Reddit-relevant set).
 * Skeletons precomputed at module load. Order doesn't matter; lookups iterate.
 */
export const BRANDS: ReadonlyArray<Brand> = Object.freeze([
    // Big tech / accounts
    { label: "google", realDomain: "google.com" },
    { label: "microsoft", realDomain: "microsoft.com" },
    { label: "apple", realDomain: "apple.com" },
    { label: "amazon", realDomain: "amazon.com" },
    { label: "facebook", realDomain: "facebook.com" },
    { label: "instagram", realDomain: "instagram.com" },
    { label: "whatsapp", realDomain: "whatsapp.com" },
    { label: "meta", realDomain: "meta.com" },
    { label: "netflix", realDomain: "netflix.com" },
    { label: "spotify", realDomain: "spotify.com" },
    { label: "adobe", realDomain: "adobe.com" },
    { label: "dropbox", realDomain: "dropbox.com" },
    { label: "linkedin", realDomain: "linkedin.com" },
    { label: "yahoo", realDomain: "yahoo.com" },
    { label: "twitter", realDomain: "twitter.com" },
    // Payments / fintech
    { label: "paypal", realDomain: "paypal.com" },
    { label: "stripe", realDomain: "stripe.com" },
    { label: "venmo", realDomain: "venmo.com" },
    { label: "cashapp", realDomain: "cash.app" },
    { label: "wise", realDomain: "wise.com" },
    { label: "zelle", realDomain: "zellepay.com" },
    // Banks
    { label: "chase", realDomain: "chase.com" },
    { label: "wellsfargo", realDomain: "wellsfargo.com" },
    { label: "bankofamerica", realDomain: "bankofamerica.com" },
    { label: "citibank", realDomain: "citibank.com" },
    { label: "capitalone", realDomain: "capitalone.com" },
    { label: "amex", realDomain: "americanexpress.com" },
    // Crypto
    { label: "coinbase", realDomain: "coinbase.com" },
    { label: "binance", realDomain: "binance.com" },
    { label: "kraken", realDomain: "kraken.com" },
    { label: "metamask", realDomain: "metamask.io" },
    { label: "ledger", realDomain: "ledger.com" },
    { label: "trezor", realDomain: "trezor.io" },
    { label: "blockchain", realDomain: "blockchain.com" },
    // Gaming / social (Reddit audience)
    { label: "steam", realDomain: "steampowered.com" },
    { label: "steamcommunity", realDomain: "steamcommunity.com" },
    { label: "discord", realDomain: "discord.com" },
    { label: "epicgames", realDomain: "epicgames.com" },
    { label: "roblox", realDomain: "roblox.com" },
    { label: "twitch", realDomain: "twitch.tv" },
    { label: "riotgames", realDomain: "riotgames.com" },
    // Shipping (SMS phishing staples)
    { label: "ups", realDomain: "ups.com" },
    { label: "fedex", realDomain: "fedex.com" },
    { label: "usps", realDomain: "usps.com" },
    { label: "dhl", realDomain: "dhl.com" },
    // Reddit itself
    { label: "reddit", realDomain: "reddit.com" },
    { label: "redditmail", realDomain: "redditmail.com" },
]);

/**
 * "Deglyph" — fold confusables, then ASCII visual look-alikes (leet/digit-letter +
 * digraph), then lowercase. Use ONLY for comparison against a known brand label,
 * never on free text (folding 0→o, 1→l everywhere is destructive).
 */
const LEET: Record<string, string> = {
    "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i",
};
const DIGRAPHS: Array<[RegExp, string]> = [
    [/rn/g, "m"],
    [/vv/g, "w"],
    [/cl/g, "d"],
];

export function deglyph(label: string): string {
    let s = foldConfusables(label.toLowerCase());
    for (const [from, to] of DIGRAPHS) s = s.replace(from, to);
    let out = "";
    for (const ch of s) out += LEET[ch] ?? ch;
    return out;
}

const BRAND_SKELETONS: ReadonlyMap<string, Brand> = new Map(BRANDS.map((b) => [deglyph(b.label), b]));

/**
 * Damerau-Levenshtein (Optimal String Alignment variant) — counts transpositions
 * as 1 edit. Bounded O(m·n); both inputs are short labels in practice.
 */
export function damerauLevenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const m = a.length;
    const n = b.length;
    const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[m][n];
}

export interface LookalikeMatch {
    brand: Brand;
    /** "homoglyph" (skeleton-equal), "combosquat" (brand inside candidate), "near-edit" (d≤2). */
    kind: "homoglyph" | "combosquat" | "near-edit";
    /** Edit distance after deglyph (0 for homoglyph/combosquat). */
    distance: number;
    /** "high" — strong action; "medium" — review queue. */
    severity: "high" | "medium";
    reason: string;
}

/**
 * Is the candidate (registrable domain "label.tld" form) a look-alike of any tracked
 * brand? Returns the best match or null. Exempts the brand's own real domain.
 *
 * Inputs: secondLevelLabel (e.g. "paypa1"), registrableDomain (e.g. "paypa1.com").
 */
export function findLookalike(secondLevelLabel: string, registrableDomain: string): LookalikeMatch | null {
    if (!secondLevelLabel) return null;
    const candidateSkel = deglyph(secondLevelLabel);

    // 1) Homoglyph / visual-equivalent: skeleton equals a brand skeleton, real domain differs.
    const direct = BRAND_SKELETONS.get(candidateSkel);
    if (direct && registrableDomain !== direct.realDomain) {
        return {
            brand: direct,
            kind: "homoglyph",
            distance: 0,
            severity: "high",
            reason: `domain '${secondLevelLabel}' is a visual look-alike of '${direct.label}' (${direct.realDomain})`,
        };
    }

    // 2) Combosquat: brand label appears verbatim inside the candidate (after deglyph),
    //    candidate != brand, not too much longer (avoid spurious substring matches).
    for (const b of BRANDS) {
        if (registrableDomain === b.realDomain) continue;
        const brandSkel = deglyph(b.label);
        if (brandSkel.length < 4) continue;
        if (candidateSkel === brandSkel) continue; // handled above
        if (
            candidateSkel.includes(brandSkel) &&
            candidateSkel.length <= brandSkel.length + 14 &&
            candidateSkel.length > brandSkel.length
        ) {
            return {
                brand: b,
                kind: "combosquat",
                distance: 0,
                severity: "high",
                reason: `combosquat: '${secondLevelLabel}' wraps the brand '${b.label}'`,
            };
        }
    }

    // 3) Near edit-distance with length gating.
    let best: LookalikeMatch | null = null;
    for (const b of BRANDS) {
        if (registrableDomain === b.realDomain) continue;
        const brandSkel = deglyph(b.label);
        if (brandSkel.length < 4) continue;
        if (Math.abs(brandSkel.length - candidateSkel.length) > 2) continue;
        const d = damerauLevenshtein(candidateSkel, brandSkel);
        if (d === 0) continue;
        if (d === 1 && brandSkel.length >= 4) {
            return {
                brand: b,
                kind: "near-edit",
                distance: 1,
                severity: "high",
                reason: `domain '${secondLevelLabel}' is 1 edit away from brand '${b.label}'`,
            };
        }
        if (d === 2 && brandSkel.length >= 8 && (!best || best.distance > 2)) {
            best = {
                brand: b,
                kind: "near-edit",
                distance: 2,
                severity: "medium",
                reason: `domain '${secondLevelLabel}' is 2 edits away from brand '${b.label}'`,
            };
        }
    }
    return best;
}

/** Convenience: feed a registrable domain like "paypa1.com" and get the verdict. */
export function lookalikeForRegistrableDomain(reg: string): LookalikeMatch | null {
    const parts = reg.split(".");
    if (parts.length < 2) return null;
    return findLookalike(parts[0], reg);
}
