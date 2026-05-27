import { canonicalizeUrl } from "./canonicalize.js";
import { containsConfusable, mixedScript } from "./normalize.js";
import { decodeHostname } from "./punycode.js";

/**
 * URL & domain intelligence — deterministic, no network calls.
 *
 * Two jobs: (1) compute the *registrable* domain (eTLD+1) using a Public-Suffix-aware
 * algorithm that knows BOTH ICANN multi-part suffixes (co.uk, com.au, ...) AND PRIVATE
 * suffixes (github.io, s3.amazonaws.com, herokuapp.com, ...) — without the private
 * section, free-hosting phishing swaps like `alice.github.io → evil.github.io` read as
 * "no new domain", a correctness hole. (2) score a URL's intrinsic risk from features
 * abuse teams actually care about, after Safe-Browsing URL canonicalization so encoding
 * evasion can't bypass the checks.
 */

/**
 * Public-Suffix-aware suffix sets. Curated to cover the high-traffic ccTLD multi-parts
 * and the top free-hosting providers. Each entry is a *fixed* suffix (no wildcards/
 * exceptions in this curated subset — keep the runtime tiny and auditable).
 *
 * Source guidance: publicsuffix.org. References to the full PSL trie in libraries like
 * tldts. We embed a pragmatic subset; the algorithm picks the LONGEST matching suffix
 * so adding more entries is monotonic and never breaks correctness.
 */
const ICANN_MULTI_PART: ReadonlySet<string> = new Set<string>([
    // United Kingdom
    "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "nhs.uk",
    "police.uk", "sch.uk", "mod.uk",
    // Australia / NZ
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au", "asn.au",
    "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz", "school.nz", "geek.nz", "kiwi.nz",
    // South Africa
    "co.za", "org.za", "gov.za", "ac.za", "edu.za", "net.za", "web.za",
    // India
    "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in", "ac.in", "edu.in", "gov.in", "nic.in",
    // Brazil
    "com.br", "net.br", "org.br", "gov.br", "edu.br",
    // Japan
    "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "ad.jp", "gr.jp", "ed.jp", "lg.jp",
    // China / HK / TW
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
    "com.hk", "net.hk", "org.hk", "edu.hk", "gov.hk",
    "com.tw", "net.tw", "org.tw", "edu.tw", "gov.tw",
    // Korea
    "co.kr", "or.kr", "go.kr", "ne.kr", "ac.kr", "pe.kr", "re.kr",
    // Others (high-traffic ccTLD multi-parts)
    "com.sg", "com.my", "com.tr", "com.ar", "com.ua", "com.pl", "com.mx", "com.ve", "com.ec",
    "com.co", "com.pe", "com.vn", "com.ph", "com.eg", "com.sa", "com.kw", "com.bh", "com.qa",
    "co.il", "co.id", "or.id", "ac.id", "net.id", "co.ke", "co.th", "or.th", "in.th",
    "com.tw", "edu.sg", "gov.sg", "net.sg", "org.sg",
]);

/**
 * Private suffixes: domains where the operator lets third parties register subdomains.
 * Without these, two different users' sites collapse to one — disastrous for "new
 * domain after approval" detection. Curated to free-hosting providers heavily abused
 * for phishing.
 */
const PRIVATE_MULTI_PART: ReadonlySet<string> = new Set<string>([
    // GitHub / GitLab / Bitbucket
    "github.io", "githubusercontent.com", "gitlab.io", "bitbucket.io",
    // AWS
    "s3.amazonaws.com", "compute.amazonaws.com", "elasticbeanstalk.com",
    "cloudfront.net", "execute-api.amazonaws.com",
    // Azure
    "azurewebsites.net", "cloudapp.net", "azureedge.net", "blob.core.windows.net",
    // Google Cloud / Firebase
    "appspot.com", "firebaseapp.com", "web.app", "run.app", "cloudfunctions.net",
    // Cloudflare
    "workers.dev", "pages.dev", "r2.dev",
    // Vercel / Netlify
    "vercel.app", "now.sh", "netlify.app", "netlify.com",
    // Heroku
    "herokuapp.com", "herokussl.com",
    // Blog / static hosts
    "blogspot.com", "tumblr.com", "wordpress.com", "weebly.com", "wixsite.com",
    // Other heavily-abused free hosts
    "000webhostapp.com", "neocities.org", "glitch.me", "repl.co", "replit.dev",
    "fly.dev", "render.com", "ngrok.io", "ngrok-free.app", "trycloudflare.com",
    "surge.sh", "gh-pages.io", "readthedocs.io", "discordapp.net", "discord.media",
]);

/** All recognized multi-part suffixes (ICANN ∪ private). */
const KNOWN_SUFFIXES: ReadonlySet<string> = new Set<string>([
    ...ICANN_MULTI_PART,
    ...PRIVATE_MULTI_PART,
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

// Phishing-favorite "trust words" — far higher signal in HOST than in path.
const HOST_TRUST_TOKENS = [
    "secure", "login", "signin", "verify", "account", "update", "confirm",
    "webscr", "banking", "wallet", "unlock", "suspend", "support",
];

const RISK_WEIGHTS = {
    shortener: 0.35,
    ipHost: 0.6,
    punycode: 0.6,
    credentials: 0.6,
    suspiciousTld: 0.4,
    manySubdomains: 0.3,
    confusableHost: 0.7,
    mixedScript: 0.85,
    hostTrustToken: 0.55,
    dangerousScheme: 0.95,
    doubleEncoded: 0.5,
    userInfoLooksLikeDomain: 0.7,
} as const;

/**
 * Registrable domain (eTLD+1) with Public-Suffix-list-aware longest-match. Tries
 * multi-label suffixes first (more specific wins), then falls back to last-two labels.
 */
export function registrableDomain(hostname: string): string {
    const host = hostname.toLowerCase().replace(/\.+$/, "");
    const labels = host.split(".").filter(Boolean);
    if (labels.length === 0) return "";
    if (labels.length <= 2) return labels.join(".");
    // Try longest suffix down — 4, 3, then default to 2.
    for (let take = Math.min(4, labels.length - 1); take >= 2; take--) {
        const suffix = labels.slice(-take).join(".");
        if (KNOWN_SUFFIXES.has(suffix)) return labels.slice(-(take + 1)).join(".");
    }
    return labels.slice(-2).join(".");
}

export interface UrlRisk {
    shortener: boolean;
    ipHost: boolean;
    punycode: boolean;
    credentials: boolean;
    suspiciousTld: boolean;
    manySubdomains: boolean;
    confusableHost: boolean;
    mixedScriptHost: boolean;
    hostTrustToken: boolean;
    dangerousScheme: boolean;
    doubleEncoded: boolean;
    userInfoLooksLikeDomain: boolean;
    /** Saturating aggregate, 0..1. */
    score: number;
    reasons: string[];
    /** Canonical hostname (post canonicalization), or "" if unparseable. */
    canonicalHost: string;
}

const EMPTY_RISK = (): UrlRisk => ({
    shortener: false, ipHost: false, punycode: false, credentials: false,
    suspiciousTld: false, manySubdomains: false, confusableHost: false,
    mixedScriptHost: false, hostTrustToken: false, dangerousScheme: false,
    doubleEncoded: false, userInfoLooksLikeDomain: false,
    score: 0, reasons: [], canonicalHost: "",
});

const DOMAIN_SHAPE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Score a single URL's intrinsic risk after canonicalization. */
export function urlRisk(rawUrl: string): UrlRisk {
    const out = EMPTY_RISK();

    // Dangerous schemes never parse as http URLs — handle them up front.
    if (/^\s*(javascript|data|vbscript|file|blob):/i.test(rawUrl)) {
        out.dangerousScheme = true;
        out.reasons.push("dangerous URL scheme (javascript/data/vbscript/file/blob)");
        out.score = 1 - Math.exp(-RISK_WEIGHTS.dangerousScheme);
        return out;
    }

    const c = canonicalizeUrl(rawUrl);
    if (!c) return out;
    out.canonicalHost = c.hostname;

    const labels = c.hostname.split(".").filter(Boolean);
    const tld = labels[labels.length - 1] ?? "";
    const reg = registrableDomain(c.hostname);
    // Decode any xn-- labels back to their Unicode form so confusable / mixed-script /
    // typosquat checks see what the user actually wrote, not the punycode-encoded form.
    const decodedHost = decodeHostname(c.hostname);
    const decodedLabels = decodedHost.split(".").filter(Boolean);

    out.shortener = SHORTENERS.has(reg);
    out.ipHost = c.isIpHost;
    out.punycode = labels.some((l) => l.startsWith("xn--"));
    out.credentials = c.username.length > 0;
    out.suspiciousTld = SUSPICIOUS_TLDS.has(tld);
    out.manySubdomains = labels.length - reg.split(".").length >= 3;
    out.confusableHost = containsConfusable(decodedHost);
    out.mixedScriptHost = decodedLabels.some((l) => mixedScript(l) !== "");
    out.hostTrustToken = HOST_TRUST_TOKENS.some((t) => c.hostname.includes(t));
    out.doubleEncoded = c.decodePasses > 1;
    out.userInfoLooksLikeDomain = c.username.length > 0 && DOMAIN_SHAPE.test(c.username);

    if (out.shortener) out.reasons.push(`URL shortener (${reg}) hides the destination`);
    if (out.ipHost) out.reasons.push("links to a raw IP address");
    if (out.punycode) out.reasons.push("punycode host (possible homograph domain)");
    if (out.credentials) out.reasons.push("credentials embedded in the URL");
    if (out.userInfoLooksLikeDomain) out.reasons.push(`'@'-trick: userinfo '${c.username}' looks like a domain`);
    if (out.suspiciousTld) out.reasons.push(`high-abuse TLD (.${tld})`);
    if (out.manySubdomains) out.reasons.push("unusually deep subdomain nesting");
    if (out.confusableHost) out.reasons.push("homoglyph characters in the domain");
    if (out.mixedScriptHost) out.reasons.push("mixed-script domain label (Latin + non-Latin)");
    if (out.hostTrustToken) out.reasons.push("phishing-style trust word in the hostname");
    if (out.doubleEncoded) out.reasons.push("URL was double-encoded (intentional obfuscation)");

    let raw = 0;
    if (out.shortener) raw += RISK_WEIGHTS.shortener;
    if (out.ipHost) raw += RISK_WEIGHTS.ipHost;
    if (out.punycode) raw += RISK_WEIGHTS.punycode;
    if (out.credentials) raw += RISK_WEIGHTS.credentials;
    if (out.userInfoLooksLikeDomain) raw += RISK_WEIGHTS.userInfoLooksLikeDomain;
    if (out.suspiciousTld) raw += RISK_WEIGHTS.suspiciousTld;
    if (out.manySubdomains) raw += RISK_WEIGHTS.manySubdomains;
    if (out.confusableHost) raw += RISK_WEIGHTS.confusableHost;
    if (out.mixedScriptHost) raw += RISK_WEIGHTS.mixedScript;
    if (out.hostTrustToken) raw += RISK_WEIGHTS.hostTrustToken;
    if (out.doubleEncoded) raw += RISK_WEIGHTS.doubleEncoded;

    out.score = 1 - Math.exp(-raw);
    return out;
}
