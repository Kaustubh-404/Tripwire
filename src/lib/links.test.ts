import { describe, expect, it } from "vitest";
import { domainOf, domainsOf, extractLinks, newItems } from "./links.js";

describe("extractLinks", () => {
    it("finds bare urls", () => {
        expect(extractLinks("check https://example.com/page now")).toEqual(["https://example.com/page"]);
    });
    it("finds markdown links", () => {
        expect(extractLinks("see [here](https://foo.com/x) please")).toContain("https://foo.com/x");
    });
    it("dedupes repeated urls", () => {
        expect(extractLinks("https://a.com https://a.com")).toEqual(["https://a.com"]);
    });
    it("strips trailing punctuation", () => {
        expect(extractLinks("read this (https://a.com/x).")).toEqual(["https://a.com/x"]);
    });
    it("returns empty for no links or nullish input", () => {
        expect(extractLinks("no links here")).toEqual([]);
        expect(extractLinks(undefined)).toEqual([]);
        expect(extractLinks(null)).toEqual([]);
    });
});

describe("domainOf", () => {
    it("normalizes host and strips www", () => {
        expect(domainOf("https://www.Example.com/x")).toBe("example.com");
    });
    it("returns empty string for non-urls", () => {
        expect(domainOf("not a url")).toBe("");
    });
});

describe("domainsOf", () => {
    it("returns unique normalized domains", () => {
        expect(domainsOf(["https://a.com/1", "https://a.com/2", "https://b.com"])).toEqual(["a.com", "b.com"]);
    });
});

describe("newItems", () => {
    it("returns items present in next but not prev", () => {
        expect(newItems(["a", "b"], ["b", "c"])).toEqual(["c"]);
    });
    it("returns empty when nothing new", () => {
        expect(newItems(["a", "b"], ["a"])).toEqual([]);
    });
});
