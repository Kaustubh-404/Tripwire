import { describe, expect, it } from "vitest";
import { registrableDomain, urlRisk } from "./url.js";

describe("registrableDomain — Public-Suffix-aware (ICANN + private)", () => {
    it("reduces deep subdomains to the org domain", () => {
        expect(registrableDomain("a.b.evil.com")).toBe("evil.com");
        expect(registrableDomain("www.example.com")).toBe("example.com");
    });
    it("handles multi-part ICANN ccTLD suffixes", () => {
        expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
        expect(registrableDomain("foo.bar.example.com.au")).toBe("example.com.au");
    });
    it("handles PRIVATE suffixes — github.io users are separate orgs (FREE-HOSTING PHISHING)", () => {
        expect(registrableDomain("alice.github.io")).toBe("alice.github.io");
        expect(registrableDomain("evil.github.io")).toBe("evil.github.io");
        expect(registrableDomain("foo.s3.amazonaws.com")).toBe("foo.s3.amazonaws.com");
        expect(registrableDomain("user.web.app")).toBe("user.web.app");
        expect(registrableDomain("bad.herokuapp.com")).toBe("bad.herokuapp.com");
    });
    it("treats different TLDs as different orgs", () => {
        expect(registrableDomain("evil.com")).not.toBe(registrableDomain("evil.co"));
    });
});

describe("urlRisk — basic features", () => {
    it("flags URL shorteners", () => {
        const r = urlRisk("https://bit.ly/abcd");
        expect(r.shortener).toBe(true);
        expect(r.score).toBeGreaterThan(0);
    });
    it("flags raw IP hosts (dotted-decimal)", () => {
        expect(urlRisk("http://203.0.113.5/login").ipHost).toBe(true);
    });
    it("flags IP-IN-DISGUISE: decimal/dword form", () => {
        // 3627734734 == 216.58.211.78
        const r = urlRisk("http://3627734734/");
        expect(r.ipHost).toBe(true);
    });
    it("flags IP-IN-DISGUISE: hex form", () => {
        expect(urlRisk("http://0x7f000001/").ipHost).toBe(true);
    });
    it("flags punycode hosts", () => {
        expect(urlRisk("https://xn--pypal-4ve.com/").punycode).toBe(true);
    });
    it("flags embedded credentials", () => {
        expect(urlRisk("https://user:pass@evil.com/").credentials).toBe(true);
    });
    it("flags the '@'-trick when userinfo looks like a domain", () => {
        const r = urlRisk("http://paypal.com@evil.ru/");
        expect(r.userInfoLooksLikeDomain).toBe(true);
        expect(r.canonicalHost).toBe("evil.ru");
    });
    it("flags high-abuse TLDs", () => {
        expect(urlRisk("https://free-prize.zip/claim").suspiciousTld).toBe(true);
    });
    it("flags phishing trust words in the HOST", () => {
        const r = urlRisk("https://secure-login-paypal.evil.com/");
        expect(r.hostTrustToken).toBe(true);
    });
    it("flags mixed-script labels (Latin + Cyrillic)", () => {
        // pаypal.com with Cyrillic 'а'
        const r = urlRisk("https://pаypal.com/");
        expect(r.mixedScriptHost).toBe(true);
    });
    it("flags dangerous schemes outright", () => {
        const r = urlRisk("javascript:alert(1)");
        expect(r.dangerousScheme).toBe(true);
        expect(r.score).toBeGreaterThan(0.5);
    });
    it("flags double-encoding (intentional obfuscation signal)", () => {
        const r = urlRisk("http://example.com/%2570");
        expect(r.doubleEncoded).toBe(true);
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
    it("returns canonicalHost = '' on garbage input", () => {
        expect(urlRisk("not a url").canonicalHost).toBe("");
    });
});
