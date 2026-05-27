import { describe, expect, it } from "vitest";
import { canonicalizeIPv4, canonicalizeUrl } from "./canonicalize.js";

describe("canonicalizeIPv4 — IP-in-disguise normalization", () => {
    it("normalizes dotted-decimal unchanged", () => {
        expect(canonicalizeIPv4("192.168.1.1")).toBe("192.168.1.1");
    });
    it("normalizes single-integer (dword) form", () => {
        expect(canonicalizeIPv4("3232235521")).toBe("192.168.0.1");
    });
    it("normalizes hex form", () => {
        expect(canonicalizeIPv4("0x7f.0x00.0x00.0x01")).toBe("127.0.0.1");
        expect(canonicalizeIPv4("0x7f000001")).toBe("127.0.0.1");
    });
    it("normalizes octal form", () => {
        expect(canonicalizeIPv4("0177.0.0.01")).toBe("127.0.0.1");
    });
    it("returns null for non-IP hosts", () => {
        expect(canonicalizeIPv4("example.com")).toBe(null);
        expect(canonicalizeIPv4("not-a-number")).toBe(null);
    });
});

describe("canonicalizeUrl — Safe Browsing canonicalization", () => {
    it("decodes percent-encoded host characters", () => {
        const r = canonicalizeUrl("http://%70aypal.com/x");
        expect(r?.hostname).toBe("paypal.com");
    });
    it("counts double-encoding passes (>1 = intentional obfuscation)", () => {
        const r = canonicalizeUrl("http://example.com/%2570");
        expect(r?.decodePasses).toBeGreaterThanOrEqual(1);
    });
    it("strips fragments", () => {
        const r = canonicalizeUrl("https://example.com/x#secret");
        expect(r?.href).not.toContain("#");
    });
    it("normalizes the host to lowercase and IPv4 if applicable", () => {
        expect(canonicalizeUrl("http://3232235521/login")?.hostname).toBe("192.168.0.1");
        expect(canonicalizeUrl("http://Example.COM/x")?.hostname).toBe("example.com");
    });
    it("flags IP hosts (including disguised ones)", () => {
        expect(canonicalizeUrl("http://3627734734/")?.isIpHost).toBe(true);
        expect(canonicalizeUrl("http://192.168.1.1/")?.isIpHost).toBe(true);
    });
    it("collapses '//' and resolves '../' in paths", () => {
        expect(canonicalizeUrl("https://example.com//a//b/../c")?.pathname).toBe("/a/c");
    });
    it("preserves userinfo (the '@'-trick signal)", () => {
        expect(canonicalizeUrl("http://paypal.com@evil.ru/")?.hostname).toBe("evil.ru");
        expect(canonicalizeUrl("http://paypal.com@evil.ru/")?.username).toBe("paypal.com");
    });
    it("rejects unparseable inputs", () => {
        expect(canonicalizeUrl("not a url")).toBe(null);
        expect(canonicalizeUrl("")).toBe(null);
    });
    it("strips tab/CR/LF inside a URL (browsers do; attackers exploit)", () => {
        const r = canonicalizeUrl("http://exa\tmple.com/x");
        expect(r?.hostname).toBe("example.com");
    });
});
