import { containsConfusable } from "./normalize.js";

/**
 * URL & domain intelligence — deterministic, no network calls.
 *
 * Two jobs: (1) compute the *registrable* domain (eTLD+1) so we compare organizations,
 * not hostnames — a.evil.com and b.evil.com are the same org, evil.com and evil.co are
 * not; (2) score a URL's intrinsic risk from features abuse teams care about (shorteners
 * that hide destinations, raw-IP hosts, punycode homographs, embedded credentials,
 * high-abuse TLDs, homoglyph domains).
 */

// Curated subset of the Public Suffix List: multi-label public suffixes where the
// registrable domain is the *third* label from the end (e.g. example.co.uk).
const MULTI_PART_SUFFIXES = new Set<string>([
    "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
    "co.nz", "net.nz", "org.nz", "govt.nz",
    "co.za", "org.za", "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in",
    "com.br", "net.br", "org.br", "gov.br",
    "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
    "com.cn", "net.cn", "org.cn", "gov.cn",
    "com.sg", "com.hk", "com.tw", "com.mx", "com.tr", "com.ar", "com.ua", "com.pl",
    "co.kr", "or.kr", "go.kr",
]);

// Known URL shorteners + link-in-bio aggregators (they hide the true destination).
const SHORTENERS = new Set<string>([
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "adf.ly",
    "bit.do", "cutt.ly", "rebrand.ly", "rb.gy", "shorturl.at", "tiny.cc", "t.ly",
    "lnkd.in", "db.tt", "qr.ae", "v.gd", "shorte.st", "soo.gd", "clck.ru", "trib.al",
    "linktr.ee", "linktree.com", "beacons.ai", "bio.link", "linkin.bio",
]);

// TLDs disproportionately abused for spam/phishing (curated).
const SUSPICIOUS_TLDS = new Set<string>([
    "zip", "mov", "top", "xyz", "gq", "tk", "ml", "cf", "ga", "work", "click", "link",
    "country", "kim", "loan", "download", "review", "stream", "racing", "win", "bid", "date",
    "rest", "fit", "cam", "monster", "quest", "sbs", "cfd",
]);

// Bounded, ReDoS-safe IPv4 matcher.
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const RISK_WEIGHTS = {
    shortener: 0.35,
    ipHost: 0.5,
    punycode: 0.6,
    credentials: 0.6,
    suspiciousTld: 0.4,
    manySubdomains: 0.3,
    confusableHost: 0.7,
} as const;

/** Registrable domain (eTLD+1), lowercased. Falls back to the host if it can't be reduced. */
export function registrableDomain(hostname: string): string {
    const host = hostname.toLowerCase().replace(/\.+$/, "");
    const labels = host.split(".").filter(Boolean);
    if (labels.length <= 2) return labels.join(".");
    const lastTwo = labels.slice(-2).join(".");
    if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
    return lastTwo;
}

export interface UrlRisk {
    shortener: boolean;
    ipHost: boolean;
    punycode: boolean;
    credentials: boolean;
    suspiciousTld: boolean;
    manySubdomains: boolean;
    confusableHost: boolean;
    /** Saturating aggregate, 0..1. */
    score: number;
    reasons: string[];
}

const EMPTY_RISK: UrlRisk = {
    shortener: false, ipHost: false, punycode: false, credentials: false,
    suspiciousTld: false, manySubdomains: false, confusableHost: false, score: 0, reasons: [],
};

/** Score a single URL's intrinsic risk from deterministic features. */
export function urlRisk(rawUrl: string): UrlRisk {
    let host = "";
    let userinfo = "";
    try {
        const u = new URL(rawUrl);
        host = u.hostname.toLowerCase();
        userinfo = u.username;
    } catch {
        return { ...EMPTY_RISK };
    }

    const labels = host.split(".").filter(Boolean);
    const tld = labels[labels.length - 1] ?? "";
    const reg = registrableDomain(host);

    const shortener = SHORTENERS.has(reg);
    const ipHost = IPV4.test(host) || host.includes(":") || host.startsWith("[");
    const punycode = labels.some((l) => l.startsWith("xn--"));
    const credentials = userinfo.length > 0;
    const suspiciousTld = SUSPICIOUS_TLDS.has(tld);
    const manySubdomains = labels.length - reg.split(".").length >= 3;
    const confusableHost = containsConfusable(host);

    const reasons: string[] = [];
    if (shortener) reasons.push(`URL shortener (${reg}) hides the destination`);
    if (ipHost) reasons.push("links to a raw IP address");
    if (punycode) reasons.push("punycode host (possible homograph domain)");
    if (credentials) reasons.push("credentials embedded in the URL");
    if (suspiciousTld) reasons.push(`high-abuse TLD (.${tld})`);
    if (manySubdomains) reasons.push("unusually deep subdomain nesting");
    if (confusableHost) reasons.push("homoglyph characters in the domain");

    let raw = 0;
    if (shortener) raw += RISK_WEIGHTS.shortener;
    if (ipHost) raw += RISK_WEIGHTS.ipHost;
    if (punycode) raw += RISK_WEIGHTS.punycode;
    if (credentials) raw += RISK_WEIGHTS.credentials;
    if (suspiciousTld) raw += RISK_WEIGHTS.suspiciousTld;
    if (manySubdomains) raw += RISK_WEIGHTS.manySubdomains;
    if (confusableHost) raw += RISK_WEIGHTS.confusableHost;

    return {
        shortener, ipHost, punycode, credentials, suspiciousTld, manySubdomains, confusableHost,
        score: 1 - Math.exp(-raw), // saturating: diminishing returns as flags stack
        reasons,
    };
}
