import { describe, expect, it } from "vitest";
import { solicitationSignals } from "./solicitation.js";

describe("solicitationSignals", () => {
    it("detects Telegram handles/links", () => {
        expect(solicitationSignals("hit me up on telegram t.me/scammer123").has("telegram")).toBe(true);
    });
    it("detects Discord invites", () => {
        expect(solicitationSignals("join discord.gg/abc123").has("discord-invite")).toBe(true);
    });
    it("detects Cash App tags", () => {
        expect(solicitationSignals("send to $JohnDoe99").has("cashapp")).toBe(true);
    });
    it("detects crypto wallets (case-sensitive base58 preserved)", () => {
        expect(solicitationSignals("pay 0x1234567890abcdef1234567890abcdef12345678").has("crypto-wallet")).toBe(true);
    });
    it("detects off-platform DM solicitation", () => {
        expect(solicitationSignals("dm me for details").has("off-platform-dm")).toBe(true);
    });
    it("sees through zero-width obfuscation", () => {
        const zwsp = String.fromCharCode(0x200b);
        expect(solicitationSignals(`dm${zwsp} me for details`).has("off-platform-dm")).toBe(true);
    });
    it("returns empty for ordinary text", () => {
        expect(solicitationSignals("what a lovely sweater, great work!").size).toBe(0);
    });
});
