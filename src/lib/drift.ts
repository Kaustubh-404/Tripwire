import { domainsOf, isCloaked, newItems, type LinkRef } from "./links.js";
import { containsConfusable, containsInvisible } from "./normalize.js";
import { solicitationSignals } from "./solicitation.js";
import { contentChange } from "./textsim.js";
import { urlRisk } from "./url.js";

/**
 * Drift scoring engine — pure, deterministic, fully unit-testable.
 *
 * Tripwire doesn't classify intent. It measures, across independent *categories*, how far
 * approved content has drifted in ways that correlate with bait-and-switch abuse, then
 * combines them with a calibrated noisy-OR so independent weak signals reinforce while no
 * single category can run away. Everything routes over the moderator's threshold to a human.
 *
 * Categories: LINK (new/risky/cloaked links), SOLICITATION (new off-platform rails),
 * OBFUSCATION (newly added invisible/homoglyph chars), STRUCTURAL (rewrite magnitude + timing).
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
    let maxNewRisk = 0;
    let riskReason = "";
    for (const ref of input.currentLinkRefs) {
        if (!addedLinks.includes(ref.href)) continue;
        const risk = urlRisk(ref.href);
        if (risk.score > maxNewRisk) {
            maxNewRisk = risk.score;
            riskReason = risk.reasons[0] ?? "";
        }
    }
    if (maxNewRisk > 0) {
        link = noisyOr([link, maxNewRisk]);
        if (riskReason) signals.push(`risky new link — ${riskReason}`);
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
    if (containsConfusable(input.currentBody) && !containsConfusable(input.approvedBody)) {
        obfuscation = Math.max(obfuscation, 0.5);
        signals.push("homoglyph (look-alike) characters added after approval");
    }

    // ---- STRUCTURAL category (rewrite magnitude + timing) ----
    // Capped low on purpose: a big honest rewrite alone should NOT auto-trigger removal.
    let structural = 0;
    const change = contentChange(input.approvedBody, input.currentBody);
    if (change > 0.4) {
        structural = Math.max(structural, 0.4 * clamp01((change - 0.4) / 0.6));
        signals.push(`body substantially rewritten (${Math.round(change * 100)}% changed)`);
    }
    if (input.lateEditHours > 0 && input.minutesSinceApproval > input.lateEditHours * 60) {
        structural = noisyOr([structural, 0.2]);
        signals.push(`edited ~${Math.round(input.minutesSinceApproval / 60)}h after approval`);
    }

    const score = noisyOr([link, solicitation, obfuscation, structural]);
    return { score, band: toBand(score), signals, addedLinks, addedDomains };
}

function toBand(score: number): DriftBand {
    if (score >= 0.8) return "high";
    if (score >= 0.5) return "medium";
    if (score >= 0.25) return "low";
    return "none";
}
