import { describe, expect, it } from "vitest";
import { scoreDrift, type DriftInput } from "./drift.js";
import { extractLinkRefs } from "./links.js";

const ZWSP = String.fromCharCode(0x200b);

function input(over: Partial<DriftInput> = {}): DriftInput {
    return {
        approvedBody: "My grandma knitted this sweater for my graduation, I am so proud of her work.",
        currentBody: "My grandma knitted this sweater for my graduation, I am so proud of her work.",
        approvedLinks: [],
        currentLinkRefs: [],
        minutesSinceApproval: 1,
        lateEditHours: 0,
        ...over,
    };
}

/** Build input where the current body is `body` and links are auto-extracted from it. */
function edited(approvedBody: string, body: string, approvedLinks: string[] = []): DriftInput {
    return input({ approvedBody, currentBody: body, approvedLinks, currentLinkRefs: extractLinkRefs(body) });
}

describe("scoreDrift — the bait-and-switch demo path", () => {
    it("scores HIGH when a brand-new external link is injected", () => {
        const r = scoreDrift(
            edited(
                "My grandma knitted this for my graduation, so proud!",
                "My grandma knitted this for my graduation! thanks all — check https://bit.ly/sketchy-shop",
            ),
        );
        expect(r.band).toBe("high");
        expect(r.score).toBeGreaterThanOrEqual(0.8);
        expect(r.addedLinks).toContain("https://bit.ly/sketchy-shop");
    });
});

describe("scoreDrift — domain swap", () => {
    it("flags a link whose destination domain changed", () => {
        const r = edited(
            "great read: https://goodsite.com/article",
            "great read: https://evil-lookalike.com/article",
            ["https://goodsite.com/article"],
        );
        const res = scoreDrift(r);
        expect(res.score).toBeGreaterThanOrEqual(0.5);
        expect(res.addedDomains).toContain("evil-lookalike.com");
    });
});

describe("scoreDrift — link cloaking", () => {
    it("scores HIGH when visible text advertises a different domain than the href", () => {
        const r = scoreDrift(
            edited("looks fine", "totally legit: [paypal.com](https://evil-phish.ru/login)"),
        );
        expect(r.score).toBeGreaterThanOrEqual(0.8);
        expect(r.signals.join(" ")).toMatch(/cloaked/i);
    });
});

describe("scoreDrift — homoglyph domain", () => {
    it("flags a new link whose domain uses look-alike characters", () => {
        const body = "see https://pаypal.com/login"; // Cyrillic 'а'
        const r = scoreDrift(edited("see my profile", body));
        expect(r.score).toBeGreaterThanOrEqual(0.5);
    });
});

describe("scoreDrift — solicitation with no clickable link", () => {
    it("flags newly-added off-platform contact rails", () => {
        const r = scoreDrift(edited("thanks for the help!", "thanks! dm me, telegram t.me/scammer123"));
        expect(r.signals.join(" ")).toMatch(/solicitation/i);
        expect(r.score).toBeGreaterThan(0.25);
    });
});

describe("scoreDrift — obfuscation", () => {
    it("flags zero-width characters added after approval", () => {
        const r = scoreDrift(input({ approvedBody: "hello world", currentBody: `hel${ZWSP}lo world` }));
        expect(r.signals.join(" ")).toMatch(/invisible/i);
        expect(r.score).toBeGreaterThanOrEqual(0.25);
    });
});

describe("scoreDrift — precision (benign edits do not auto-trigger)", () => {
    it("identical content scores zero", () => {
        const r = scoreDrift(input());
        expect(r.band).toBe("none");
        expect(r.score).toBe(0);
    });
    it("a typo fix stays below the default action threshold (0.5)", () => {
        const r = scoreDrift(
            input({
                approvedBody: "My grandma knited this sweater for my graduation, I am so proud of her work.",
                currentBody: "My grandma knitted this sweater for my graduation, I am so proud of her work.",
            }),
        );
        expect(r.score).toBeLessThan(0.5);
    });
    it("timing alone never crosses the action threshold", () => {
        const r = scoreDrift(input({ minutesSinceApproval: 6000, lateEditHours: 1 }));
        expect(r.score).toBeLessThan(0.5);
    });
    it("a big honest rewrite alone (no links/solicitation) stays below threshold", () => {
        const r = scoreDrift(
            input({
                approvedBody: "Short original text about my day.",
                currentBody: "Completely different and much longer update where I describe many unrelated new events in detail.",
            }),
        );
        expect(r.score).toBeLessThan(0.5);
    });
});

describe("scoreDrift — adding a link to an already-approved domain", () => {
    it("registers the new link but lower than a new-domain injection", () => {
        const approved = "Here is my detailed write-up with a reference: https://goodsite.com/a and lots of context.";
        const current = `${approved} Also see https://goodsite.com/b for more.`;
        const r = scoreDrift(edited(approved, current, ["https://goodsite.com/a"]));
        expect(r.addedDomains).toEqual([]); // same org domain
        expect(r.score).toBeGreaterThanOrEqual(0.5);
        expect(r.score).toBeLessThan(0.8); // not as severe as a new domain / cloaking
    });
});
