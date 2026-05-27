import { domainsOf, hrefDomain, isCloaked, isDangerousScheme, newItems, type LinkRef } from "./links.js";
import { containsBidi, containsConfusable, containsInvisible } from "./normalize.js";
import { decodeHostname } from "./punycode.js";
import { solicitationSignals } from "./solicitation.js";
import { analyzeChange } from "./textsim.js";
import { findLookalike } from "./typosquat.js";
import { urlRisk } from "./url.js";

/**
 * Drift scoring engine — pure, deterministic, fully unit-testable.
 *
 * Tripwire doesn't classify intent. It measures, across independent *categories*, how far
 * approved content has drifted in ways that correlate with bait-and-switch abuse, then
 * combines them with a calibrated noisy-OR so independent weak signals reinforce while no
 * single category can run away. Everything above threshold routes to a human.
 *
 * Categories: LINK (new/risky/cloaked links, dangerous schemes, typosquats),
 * SOLICITATION (new off-platform rails), OBFUSCATION (newly added invisible/bidi/homoglyph
 * chars), STRUCTURAL (rewrite magnitude + added-fraction + timing).
 *
 * Calibration follows research-backed precision-first asymmetry: auto-action band starts
 * at 0.85 so a wrongful auto-removal essentially needs one near-certain category, not two
 * soft signals adding up. Notify/review tier is high-recall; log is the audit trail.
 */

export type DriftBand = "none" | "low" | "medium" | "high";

export interface DriftInput {
    approvedBody: string;
    currentBody: string;
    /** Hrefs present at approval time. */
    approvedLinks: string[];
    /** (visible text, href) pairs present now. */
    currentLinkRefs: LinkRef[];
    minutesSinceApproval: number;
    /** 0 disables the timing signal. */
    lateEditHours: number;
}

export interface DriftResult {
    score: number;
    band: DriftBand;
    signals: string[];
    addedLinks: string[];
    addedDomains: string[];
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Combine independent category scores: 1 - Π(1 - cᵢ). Saturating, calibrated, 0..1. */
function noisyOr(parts: number[]): number {
    let product = 1;
    for (const c of parts) product *= 1 - clamp01(c);
    return 1 - product;
}

export function scoreDrift(input: DriftInput): DriftResult {
    const signals: string[] = [];

    const currentHrefs = input.currentLinkRefs.map((r) => r.href);
    const addedLinks = newItems(input.approvedLinks, currentHrefs);
    const addedDomains = newItems(domainsOf(input.approvedLinks), domainsOf(currentHrefs));

    // ---- LINK category ----
    let link = 0;
    if (addedLinks.length > 0) {
        link = Math.max(link, 0.6);
        signals.push(`new link added after approval: ${addedLinks[0]}`);
    }
    if (addedDomains.length > 0) {
        link = Math.max(link, 0.75);
        signals.push(`new destination domain not in approved version: ${addedDomains[0]}`);
    }
    // Per-link risk + typosquat lookup for *newly added* links only.
    let maxNewRisk = 0;
    let riskReason = "";
    let typosquatHit: string | null = null;
    for (const ref of input.currentLinkRefs) {
        if (isDangerousScheme(ref.href)) {
            link = noisyOr([link, 0.95]);
            signals.push(`dangerous URL scheme used: ${ref.href.split(":")[0]}:`);
            continue;
        }
        if (!addedLinks.includes(ref.href)) continue;
        const risk = urlRisk(ref.href);
        if (risk.score > maxNewRisk) {
            maxNewRisk = risk.score;
            riskReason = risk.reasons[0] ?? "";
        }
        // Typosquat / look-alike — check the new link's registrable domain, with
        // any xn-- labels decoded so homograph spoofs become visible.
        if (!typosquatHit) {
            const reg = decodeHostname(hrefDomain(ref.href));
            const parts = reg.split(".");
            if (parts.length >= 2) {
                const la = findLookalike(parts[0], reg);
                if (la) typosquatHit = la.reason;
            }
        }
    }
    if (maxNewRisk > 0) {
        link = noisyOr([link, maxNewRisk]);
        if (riskReason) signals.push(`risky new link — ${riskReason}`);
    }
    if (typosquatHit) {
        link = noisyOr([link, 0.9]);
        signals.push(`brand look-alike: ${typosquatHit}`);
    }
    const cloaked = input.currentLinkRefs.find((r) => isCloaked(r));
    if (cloaked) {
        link = noisyOr([link, 0.85]);
        signals.push(`cloaked link: the visible text shows a different domain than where it goes (${cloaked.href})`);
    }

    // ---- SOLICITATION category (newly added rails) ----
    const approvedSolic = solicitationSignals(input.approvedBody);
    const newSolic = [...solicitationSignals(input.currentBody)].filter((s) => !approvedSolic.has(s));
    let solicitation = 0;
    if (newSolic.length > 0) {
        solicitation = 1 - Math.exp(-0.5 * newSolic.length); // saturating in count
        signals.push(`new off-platform solicitation: ${newSolic.join(", ")}`);
    }

    // ---- OBFUSCATION category (newly present) ----
    let obfuscation = 0;
    if (containsInvisible(input.currentBody) && !containsInvisible(input.approvedBody)) {
        obfuscation = Math.max(obfuscation, 0.4);
        signals.push("hidden/invisible characters added after approval");
    }
    if (containsBidi(input.currentBody) && !containsBidi(input.approvedBody)) {
        obfuscation = noisyOr([obfuscation, 0.75]);
        signals.push("bidi/Trojan-Source control characters added after approval");
    }
    if (containsConfusable(input.currentBody) && !containsConfusable(input.approvedBody)) {
        obfuscation = noisyOr([obfuscation, 0.5]);
        signals.push("homoglyph (look-alike) characters added after approval");
    }

    // ---- STRUCTURAL category (rewrite + added-fraction + timing) ----
    // Capped low on purpose: a big honest rewrite alone should NOT auto-trigger removal.
    let structural = 0;
    const change = analyzeChange(input.approvedBody, input.currentBody);
    const netChange = 1 - change.similarity;
    if (netChange > 0.4) {
        structural = Math.max(structural, 0.4 * clamp01((netChange - 0.4) / 0.6));
        signals.push(`body substantially rewritten (${Math.round(netChange * 100)}% net change)`);
    }
    // Dilution-resistant: a lot of NEW content (regardless of net similarity) is suspicious
    // when paired with other signals. Capped low so pure append alone doesn't trigger.
    if (change.addedFraction > 0.5) {
        structural = noisyOr([structural, 0.3 * clamp01((change.addedFraction - 0.5) / 0.5)]);
        signals.push(`${Math.round(change.addedFraction * 100)}% of current text was added after approval`);
    }
    if (input.lateEditHours > 0 && input.minutesSinceApproval > input.lateEditHours * 60) {
        structural = noisyOr([structural, 0.2]);
        signals.push(`edited ~${Math.round(input.minutesSinceApproval / 60)}h after approval`);
    }

    const score = noisyOr([link, solicitation, obfuscation, structural]);
    return { score, band: toBand(score), signals, addedLinks, addedDomains };
}

/**
 * Bands tuned for precision-first asymmetry (auto-removal must be high-precision):
 *   high   ≥ 0.85 — auto-action allowed (one near-certain category needed)
 *   medium ≥ 0.55 — review/notify (human backstop, higher recall)
 *   low    ≥ 0.30 — audit-only log
 *   none   <  0.30
 */
function toBand(score: number): DriftBand {
    if (score >= 0.85) return "high";
    if (score >= 0.55) return "medium";
    if (score >= 0.30) return "low";
    return "none";
}
