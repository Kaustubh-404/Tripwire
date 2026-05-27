import { stripAndFold } from "./normalize.js";

/**
 * Off-platform solicitation + payment-rail detection.
 *
 * Not every scam adds a clickable link. "DM me on Telegram," a Cash App $cashtag, a crypto
 * wallet, a paypal.me — these are the no-link bait-and-switch. We detect them on de-obfuscated
 * text (homoglyph/zero-width neutralized) and report them as a set so the scorer can act on
 * what was *newly added* after approval. All patterns are bounded (ReDoS-safe).
 */

interface SolicitationPattern {
    name: string;
    re: RegExp;
}

const PATTERNS: SolicitationPattern[] = [
    { name: "telegram", re: /\b(?:t\.me\/[a-z0-9_]+|telegram\.me\/[a-z0-9_]+|on telegram)\b/i },
    { name: "whatsapp", re: /\b(?:wa\.me\/\d+|chat\.whatsapp\.com\/[a-z0-9]+|whatsapp)\b/i },
    { name: "discord-invite", re: /\b(?:discord\.gg|discord\.com\/invite)\/[a-z0-9]+/i },
    { name: "cashapp", re: /(?:^|\s)\$[a-z][a-z0-9_]{1,20}\b/i },
    { name: "paypal-me", re: /\bpaypal\.me\/[a-z0-9]+/i },
    { name: "venmo", re: /\bvenmo\b/i },
    // Case-sensitive: ETH (0x..), and BTC base58 (mixed case) — no /i flag.
    { name: "crypto-wallet", re: /\b(?:0x[a-fA-F0-9]{40}|bc1[a-z0-9]{20,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/ },
    { name: "email", re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/ },
    { name: "off-platform-dm", re: /\b(?:dm me|pm me|message me directly|hit me up|contact me directly|link in bio)\b/i },
];

/** Return the set of solicitation pattern names present in the text. */
export function solicitationSignals(text: string | undefined | null): Set<string> {
    const folded = stripAndFold(text);
    const found = new Set<string>();
    if (!folded) return found;
    for (const p of PATTERNS) {
        if (p.re.test(folded)) found.add(p.name);
    }
    return found;
}
