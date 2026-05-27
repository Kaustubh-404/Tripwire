import { describe, expect, it } from "vitest";
import { registrableDomain, urlRisk } from "./url.js";

describe("registrableDomain (eTLD+1)", () => {
    it("reduces deep subdomains to the org domain", () => {
        expect(registrableDomain("a.b.evil.com")).toBe("evil.com");
        expect(registrableDomain("www.example.com")).toBe("example.com");
    });
    it("handles multi-part public suffixes", () => {
        expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
        expect(registrableDomain("foo.bar.example.com.au")).toBe("example.com.au");
    });
    it("treats different TLDs as different orgs", () => {
        expect(registrableDomain("evil.com")).not.toBe(registrableDomain("evil.co"));
    });
});

describe("urlRisk", () => {
    it("flags URL shorteners", () => {
        const r = urlRisk("https://bit.ly/abcd");
        expect(r.shortener).toBe(true);
        expect(r.score).toBeGreaterThan(0);
    });
    it("flags raw IP hosts", () => {
        expect(urlRisk("http://203.0.113.5/login").ipHost).toBe(true);
    });
    it("flags punycode (homograph) hosts", () => {
        expect(urlRisk("https://xn--pypal-4ve.com/").punycode).toBe(true);
    });
    it("flags embedded credentials", () => {
        expect(urlRisk("https://user:pass@evil.com/").credentials).toBe(true);
    });
    it("flags high-abuse TLDs", () => {
        expect(urlRisk("https://free-prize.zip/claim").suspiciousTld).toBe(true);
    });
    it("scores a clean mainstream link as zero risk", () => {
        const r = urlRisk("https://www.wikipedia.org/wiki/Reddit");
        expect(r.score).toBe(0);
        expect(r.reasons).toHaveLength(0);
    });
    it("stacks features with diminishing returns (stays <= 1)", () => {
        const r = urlRisk("https://u:p@1.2.3.4/x");
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1);
    });
    it("returns empty risk for unparseable input", () => {
        expect(urlRisk("not a url").score).toBe(0);
    });
});
