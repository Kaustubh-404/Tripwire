import { describe, expect, it } from "vitest";
import { scoreDrift, type DriftInput } from "./drift.js";

function base(overrides: Partial<DriftInput> = {}): DriftInput {
    return {
        approvedLinks: [],
        approvedDomains: [],
        approvedBody: "My grandma knitted this sweater for my graduation.",
        currentLinks: [],
        currentDomains: [],
        currentBody: "My grandma knitted this sweater for my graduation.",
        minutesSinceApproval: 1,
        lateEditHours: 0,
        ...overrides,
    };
}

describe("scoreDrift — the bait-and-switch demo path", () => {
    it("trips hard when a brand-new external link is injected into a no-link post", () => {
        const r = scoreDrift(
            base({
                currentLinks: ["https://bit.ly/sketchy-shop"],
                currentDomains: ["bit.ly"],
                currentBody: "thanks everyone! btw I sell these, check https://bit.ly/sketchy-shop",
            }),
        );
        expect(r.score).toBeGreaterThanOrEqual(0.5);
        expect(r.addedLinks).toContain("https://bit.ly/sketchy-shop");
        expect(r.signals.join(" ")).toMatch(/new link/);
    });
});

describe("scoreDrift — domain swap", () => {
    it("flags a link whose destination domain changed after approval", () => {
        const r = scoreDrift(
            base({
                approvedLinks: ["https://goodsite.com/article"],
                approvedDomains: ["goodsite.com"],
                approvedBody: "Great read: https://goodsite.com/article",
                currentLinks: ["https://evil-lookalike.com/article"],
                currentDomains: ["evil-lookalike.com"],
                currentBody: "Great read: https://evil-lookalike.com/article",
            }),
        );
        expect(r.score).toBeGreaterThanOrEqual(0.5);
        expect(r.addedDomains).toContain("evil-lookalike.com");
    });
});

describe("scoreDrift — benign edits do not trip", () => {
    it("scores zero for a typo fix with no link change", () => {
        const r = scoreDrift(
            base({
                approvedBody: "My grandma knited this sweater.",
                currentBody: "My grandma knitted this sweater.",
            }),
        );
        expect(r.score).toBe(0);
        expect(r.signals).toHaveLength(0);
    });

    it("does not trip on timing alone (no link/domain/body change)", () => {
        const r = scoreDrift(base({ minutesSinceApproval: 600, lateEditHours: 1 }));
        expect(r.score).toBeLessThan(0.5);
    });
});

describe("scoreDrift — adding a link to an already-approved domain", () => {
    it("registers the new link but at lower confidence (no new domain, no big rewrite)", () => {
        // A long enough body that adding one link is not a "substantial rewrite",
        // isolating the link-added signal (0.6) from the body-rewrite signal.
        const longBody =
            "Here is a detailed write-up of my project with lots of context and explanation " +
            "so that the body is long enough not to trip the rewrite heuristic when I add a link. " +
            "Reference: https://a.com/x";
        const r = scoreDrift(
            base({
                approvedLinks: ["https://a.com/x"],
                approvedDomains: ["a.com"],
                approvedBody: longBody,
                currentLinks: ["https://a.com/x", "https://a.com/y"],
                currentDomains: ["a.com"],
                currentBody: `${longBody} and also https://a.com/y`,
            }),
        );
        expect(r.addedLinks).toEqual(["https://a.com/y"]);
        expect(r.addedDomains).toEqual([]);
        expect(r.score).toBeCloseTo(0.6, 5);
    });
});
