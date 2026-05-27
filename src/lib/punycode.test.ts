import { describe, expect, it } from "vitest";
import { decodeHostname, punycodeDecodeLabel } from "./punycode.js";

describe("punycodeDecodeLabel — RFC 3492 round-trip", () => {
    it("decodes the canonical example: 'mnchen-3ya' -> 'münchen'", () => {
        expect(punycodeDecodeLabel("mnchen-3ya")).toBe("münchen");
    });
    it("decodes a Cyrillic-spoofed paypal label", () => {
        // pаypal (Cyrillic а) -> xn--pypal-4ve
        expect(punycodeDecodeLabel("pypal-4ve")).toBe("pаypal");
    });
    it("returns null for malformed input", () => {
        expect(punycodeDecodeLabel("!!invalid!!")).toBe(null);
    });
});

describe("decodeHostname — leaves ASCII labels alone, decodes xn-- labels", () => {
    it("decodes mixed-IDN hostnames", () => {
        // xn--pypal-4ve.com -> pаypal.com (Cyrillic а)
        const decoded = decodeHostname("xn--pypal-4ve.com");
        expect(decoded).toBe("pаypal.com");
    });
    it("passes through pure ASCII unchanged", () => {
        expect(decodeHostname("example.com")).toBe("example.com");
    });
});
