import { describe, expect, it } from "vitest";
import {
    defangDomainMentions,
    domainsOf,
    extractLinkRefs,
    extractLinks,
    hrefDomain,
    isCloaked,
    isDangerousScheme,
    newItems,
} from "./links.js";

describe("extractLinkRefs — basic forms", () => {
    it("captures bare URLs with empty visible text", () => {
        const refs = extractLinkRefs("check https://example.com/page now");
        expect(refs).toEqual([{ href: "https://example.com/page", text: "" }]);
    });
    it("captures markdown links as (text, href) pairs", () => {
        const refs = extractLinkRefs("see [click here](https://foo.com/x) please");
        expect(refs[0]).toEqual({ href: "https://foo.com/x", text: "click here" });
    });
    it("dedupes and strips trailing punctuation", () => {
        expect(extractLinks("read this (https://a.com/x). https://a.com/x")).toEqual(["https://a.com/x"]);
    });
    it("returns empty for nullish input", () => {
        expect(extractLinkRefs(undefined)).toEqual([]);
    });
});

describe("extractLinkRefs — code-span and fenced-block masking (FP killer)", () => {
    it("ignores links inside inline code spans", () => {
        const refs = extractLinkRefs("use `https://example.com/x` as a placeholder");
        expect(refs).toHaveLength(0);
    });
    it("ignores links inside fenced code blocks", () => {
        const refs = extractLinkRefs("```\nclick https://evil.ru/x\n```\nother text");
        expect(refs).toHaveLength(0);
    });
    it("still extracts links outside code", () => {
        const refs = extractLinkRefs("see https://example.com but not `https://evil.ru`");
        expect(refs.map((r) => r.href)).toEqual(["https://example.com"]);
    });
});

describe("extractLinkRefs — reference-style links (silent miss before)", () => {
    it("resolves full reference: [text][label] + [label]: url", () => {
        const body = "Check the [docs][a] for details.\n\n[a]: https://evil.ru/payload";
        const refs = extractLinkRefs(body);
        expect(refs.map((r) => r.href)).toContain("https://evil.ru/payload");
    });
    it("resolves collapsed reference: [text][] + [text]: url", () => {
        const body = "Click [PayPal][] now.\n\n[paypal]: https://evil.ru";
        const refs = extractLinkRefs(body);
        expect(refs.map((r) => r.href)).toContain("https://evil.ru");
    });
    it("resolves shortcut reference: [text] + [text]: url", () => {
        const body = "Click [special-link].\n\n[special-link]: https://evil.ru/x";
        const refs = extractLinkRefs(body);
        expect(refs.map((r) => r.href)).toContain("https://evil.ru/x");
    });
});

describe("extractLinkRefs — autolinks + bare www.", () => {
    it("captures <https://…> autolinks", () => {
        expect(extractLinks("see <https://example.com/x>")).toContain("https://example.com/x");
    });
    it("captures bare www. as https://www....", () => {
        expect(extractLinks("visit www.example.com/page today")).toContain("https://www.example.com/page");
    });
});

describe("extractLinkRefs — dangerous schemes", () => {
    it("extracts javascript: links from markdown so they can be flagged", () => {
        const refs = extractLinkRefs("[click me](javascript:alert(1))");
        expect(refs[0]?.href.startsWith("javascript:")).toBe(true);
        expect(isDangerousScheme(refs[0]!.href)).toBe(true);
    });
    it("extracts data: links similarly", () => {
        const refs = extractLinkRefs("[ok](data:text/html,<script>alert(1)</script>)");
        expect(refs[0]?.href.startsWith("data:")).toBe(true);
    });
    it("does not flag normal http(s) links as dangerous", () => {
        expect(isDangerousScheme("https://example.com")).toBe(false);
    });
});

describe("hrefDomain / domainsOf (registrable)", () => {
    it("returns the registrable domain", () => {
        expect(hrefDomain("https://www.example.com/x")).toBe("example.com");
        expect(hrefDomain("https://a.b.evil.co.uk/x")).toBe("evil.co.uk");
    });
    it("collapses subdomains to unique org domains", () => {
        expect(domainsOf(["https://a.evil.com/1", "https://b.evil.com/2", "https://ok.org"])).toEqual([
            "evil.com",
            "ok.org",
        ]);
    });
});

describe("isCloaked — visible text vs real destination", () => {
    it("flags a label that advertises a different domain", () => {
        expect(isCloaked({ text: "paypal.com", href: "https://evil-phish.ru/login" })).toBe(true);
    });
    it("sees through homoglyph labels", () => {
        expect(isCloaked({ text: "pаypal.com", href: "https://evil.ru" })).toBe(true);
    });
    it("sees through defanged labels: paypal[.]com → paypal.com", () => {
        expect(isCloaked({ text: "paypal[.]com", href: "https://evil.ru" })).toBe(true);
    });
    it("does not flag when label and destination match", () => {
        expect(isCloaked({ text: "example.com", href: "https://example.com/page" })).toBe(false);
    });
    it("does not flag non-domain labels", () => {
        expect(isCloaked({ text: "click here", href: "https://example.com" })).toBe(false);
    });
});

describe("defangDomainMentions", () => {
    it("recovers bracketed-dot defangs", () => {
        expect(defangDomainMentions("paypal[.]com")).toBe("paypal.com");
        expect(defangDomainMentions("paypal(.)com")).toBe("paypal.com");
        expect(defangDomainMentions("paypal{.}com")).toBe("paypal.com");
    });
    it('recovers "dot" word defangs', () => {
        expect(defangDomainMentions("paypal dot com")).toBe("paypal.com");
        expect(defangDomainMentions("paypal (dot) com")).toBe("paypal.com");
    });
    it("recovers spaced-dot defang", () => {
        expect(defangDomainMentions("paypal . com")).toBe("paypal.com");
    });
    it("recovers hxxp scheme defang", () => {
        expect(defangDomainMentions("hxxps://evil.ru")).toBe("https://evil.ru");
    });
});

describe("newItems", () => {
    it("returns set difference", () => {
        expect(newItems(["a", "b"], ["b", "c"])).toEqual(["c"]);
    });
});

describe("ReDoS resilience (sanity)", () => {
    it("handles pathological-shaped input quickly", () => {
        const evil = "[" + "a".repeat(2000) + "](" + "b".repeat(2000);
        const t0 = Date.now();
        extractLinkRefs(evil);
        expect(Date.now() - t0).toBeLessThan(200);
    });
});
