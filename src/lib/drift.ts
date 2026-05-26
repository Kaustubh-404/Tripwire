import { newItems } from "./links.js";

/**
 * Drift scoring — pure and deterministic so it's fully unit-testable.
 *
 * Tripwire doesn't classify intent ("is this a scam?"). It measures how far approved
 * content has structurally drifted in ways that correlate with bait-and-switch abuse,
 * and routes anything over the moderator's threshold back to a human. The human makes
 * the call; Tripwire just makes sure the human gets to.
 */

export interface DriftWeights {
    /** A new outbound link appeared that wasn't in the approved version. */
    linkAdded: number;
    /** A domain appeared that wasn't approved (covers link swaps to new destinations). */
    newDomain: number;
    /** The edit landed well after approval (sleeper edit), only if timing is enabled. */
    lateEdit: number;
    /** The body was substantially rewritten. */
    bodyRewrite: number;
}

export const DEFAULT_WEIGHTS: DriftWeights = {
    linkAdded: 0.6,
    newDomain: 0.5,
    lateEdit: 0.2,
    bodyRewrite: 0.2,
};

/** Fraction of the body (0–1) that must change to count as a substantial rewrite. */
export const BODY_REWRITE_THRESHOLD = 0.4;

export interface DriftInput {
    approvedLinks: string[];
    approvedDomains: string[];
    approvedBody: string;
    currentLinks: string[];
    currentDomains: string[];
    currentBody: string;
    minutesSinceApproval: number;
    /** 0 disables the timing signal. */
    lateEditHours: number;
}

export interface DriftResult {
    score: number;
    signals: string[];
    addedLinks: string[];
    addedDomains: string[];
}

export function scoreDrift(input: DriftInput, weights: DriftWeights = DEFAULT_WEIGHTS): DriftResult {
    const addedLinks = newItems(input.approvedLinks, input.currentLinks);
    const addedDomains = newItems(input.approvedDomains, input.currentDomains);
    const signals: string[] = [];
    let score = 0;

    if (addedLinks.length > 0) {
        score += weights.linkAdded;
        signals.push(`new link added after approval: ${addedLinks[0]}`);
    }
    if (addedDomains.length > 0) {
        score += weights.newDomain;
        signals.push(`new domain not in approved version: ${addedDomains[0]}`);
    }
    if (input.lateEditHours > 0 && input.minutesSinceApproval > input.lateEditHours * 60) {
        score += weights.lateEdit;
        signals.push(`edited ~${Math.round(input.minutesSinceApproval / 60)}h after approval`);
    }
    const delta = lengthDelta(input.approvedBody, input.currentBody);
    if (delta > BODY_REWRITE_THRESHOLD) {
        score += weights.bodyRewrite;
        signals.push(`body changed substantially (${Math.round(delta * 100)}%)`);
    }

    return { score: Math.min(1, score), signals, addedLinks, addedDomains };
}

/** Normalized magnitude of length change between two strings, 0–1. */
export function lengthDelta(a: string, b: string): number {
    const max = Math.max(a.length, b.length);
    return max === 0 ? 0 : Math.abs(a.length - b.length) / max;
}
