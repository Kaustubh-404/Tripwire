import { describe, expect, it } from "vitest";
import { domainsOf, extractLinkRefs, extractLinks, hrefDomain, isCloaked, newItems } from "./links.js";

describe("extractLinkRefs", () => {
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
    it("flags a link whose label advertises a different domain", () => {
        expect(isCloaked({ text: "paypal.com", href: "https://evil-phish.ru/login" })).toBe(true);
    });
    it("sees through homoglyph labels", () => {
        // Cyrillic 'а' in the visible label still resolves to paypal.com after normalization.
        expect(isCloaked({ text: "pаypal.com", href: "https://evil.ru" })).toBe(true);
    });
    it("does not flag when label and destination match", () => {
        expect(isCloaked({ text: "example.com", href: "https://example.com/page" })).toBe(false);
    });
    it("does not flag non-domain labels", () => {
        expect(isCloaked({ text: "click here", href: "https://example.com" })).toBe(false);
    });
});

describe("newItems", () => {
    it("returns set difference", () => {
        expect(newItems(["a", "b"], ["b", "c"])).toEqual(["c"]);
    });
});
