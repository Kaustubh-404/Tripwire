import { describe, expect, it } from "vitest";
import { scoreDrift, type DriftInput } from "./drift.js";
import { extractLinkRefs } from "./links.js";

const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);

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

function edited(approvedBody: string, body: string, approvedLinks: string[] = []): DriftInput {
    return input({ approvedBody, currentBody: body, approvedLinks, currentLinkRefs: extractLinkRefs(body) });
}

describe("scoreDrift — bait-and-switch demo path", () => {
    it("scores HIGH when a brand-new external link is injected", () => {
        const r = scoreDrift(
            edited(
                "My grandma knitted this for my graduation, so proud!",
                "My grandma knitted this for my graduation! thanks all — check https://bit.ly/sketchy-shop",
            ),
        );
        expect(r.band).toBe("high");
        expect(r.score).toBeGreaterThanOrEqual(0.85);
    });
});

describe("scoreDrift — domain swap", () => {
    it("flags a link whose destination domain changed", () => {
        const r = scoreDrift(
            edited(
                "great read: https://goodsite.com/article",
                "great read: https://evil-lookalike.com/article",
                ["https://goodsite.com/article"],
            ),
        );
        expect(r.band === "medium" || r.band === "high").toBe(true);
    });
});

describe("scoreDrift — link cloaking", () => {
    it("scores HIGH when label != href domain", () => {
        const r = scoreDrift(edited("looks fine", "totally legit: [paypal.com](https://evil-phish.ru/login)"));
        expect(r.score).toBeGreaterThanOrEqual(0.85);
        expect(r.signals.join(" ")).toMatch(/cloaked/i);
    });
    it("sees through defanged labels", () => {
        const r = scoreDrift(edited("looks fine", "[paypal[.]com](https://evil-phish.ru)"));
        expect(r.score).toBeGreaterThanOrEqual(0.85);
    });
});

describe("scoreDrift — typosquat / look-alike domains (FAANG-grade)", () => {
    it("flags a Cyrillic-spoofed paypal domain as a brand look-alike", () => {
        const r = scoreDrift(edited("see my profile", "see https://pаypal.com/login")); // Cyrillic 'а'
        expect(r.band).toBe("high");
        expect(r.signals.join(" ")).toMatch(/look-alike|brand/i);
    });
    it("flags a leet-spoofed paypal (paypa1.com)", () => {
        const r = scoreDrift(edited("see", "click https://paypa1.com/login"));
        expect(r.band).toBe("high");
    });
    it("flags a combosquat (paypal-secure.com)", () => {
        const r = scoreDrift(edited("see", "https://paypal-secure.com/verify"));
        expect(r.band).toBe("high");
    });
});

describe("scoreDrift — dangerous schemes", () => {
    it("scores HIGH on javascript: link injection", () => {
        const r = scoreDrift(edited("ok", "[click](javascript:alert(1))"));
        expect(r.band).toBe("high");
        expect(r.signals.join(" ")).toMatch(/dangerous/i);
    });
});

describe("scoreDrift — Trojan-Source / obfuscation injection", () => {
    it("scores HIGH when bidi controls appear after approval", () => {
        const r = scoreDrift(input({ approvedBody: "looks legit", currentBody: `looks${RLO}legit and admin` }));
        expect(r.band === "medium" || r.band === "high").toBe(true);
        expect(r.signals.join(" ")).toMatch(/bidi|trojan/i);
    });
    it("flags zero-width chars added after approval", () => {
        const r = scoreDrift(input({ approvedBody: "hello world", currentBody: `hel${ZWSP}lo world` }));
        expect(r.score).toBeGreaterThanOrEqual(0.30);
    });
});

describe("scoreDrift — IP-in-disguise (decimal IP host)", () => {
    it("flags a decimal-IP host as risky on a newly-added link", () => {
        const r = scoreDrift(edited("ok", "click http://3627734734/login"));
        expect(r.band === "medium" || r.band === "high").toBe(true);
    });
});

describe("scoreDrift — solicitation with no clickable link", () => {
    it("flags newly-added off-platform contact rails", () => {
        const r = scoreDrift(edited("thanks for the help!", "thanks! dm me, telegram t.me/scammer123"));
        expect(r.signals.join(" ")).toMatch(/solicitation/i);
        expect(r.score).toBeGreaterThan(0.30);
    });
});

describe("scoreDrift — precision (benign edits do not auto-trigger)", () => {
    it("identical content scores zero", () => {
        const r = scoreDrift(input());
        expect(r.band).toBe("none");
        expect(r.score).toBe(0);
    });
    it("a typo fix stays in 'none'", () => {
        const r = scoreDrift(
            input({
                approvedBody: "My grandma knited this sweater for my graduation, I am so proud of her work.",
                currentBody: "My grandma knitted this sweater for my graduation, I am so proud of her work.",
            }),
        );
        expect(r.band).toBe("none");
    });
    it("timing alone never crosses the auto-action band (FP asymmetry)", () => {
        const r = scoreDrift(input({ minutesSinceApproval: 6000, lateEditHours: 1 }));
        expect(r.band === "none" || r.band === "low").toBe(true);
        expect(r.score).toBeLessThan(0.85);
    });
    it("a big honest rewrite alone (no links/solicitation) stays below auto-action", () => {
        const r = scoreDrift(
            input({
                approvedBody: "Short original text about my day.",
                currentBody: "Completely different and much longer update where I describe many unrelated new events in detail.",
            }),
        );
        expect(r.score).toBeLessThan(0.85);
    });
});

describe("scoreDrift — anti-dilution (filler padding cannot suppress added-content signal)", () => {
    it("flags a malicious link injection even when most of the approved body is preserved as filler", () => {
        const approved = "great post and helpful info about the topic discussed here";
        const padded = `${approved} additionally please consider visiting https://bit.ly/sketchy-shop for more`;
        const r = scoreDrift(edited(approved, padded, []));
        // New shortener domain + addedFraction reach the action tier; medium-or-high
        // is the correct outcome (medium routes to the human-in-loop backstop).
        expect(r.band === "medium" || r.band === "high").toBe(true);
    });
});

describe("scoreDrift — adding a link to an already-approved domain", () => {
    it("registers the new link, but at lower confidence than a new domain", () => {
        const approved = "Here is my detailed write-up with a reference: https://goodsite.com/a and lots of context.";
        const current = `${approved} Also see https://goodsite.com/b for more.`;
        const r = scoreDrift(edited(approved, current, ["https://goodsite.com/a"]));
        expect(r.addedDomains).toEqual([]);
        expect(r.score).toBeGreaterThanOrEqual(0.55);
        expect(r.score).toBeLessThan(0.85);
    });
});
