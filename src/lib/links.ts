import { normalizeForMatch } from "./normalize.js";
import { registrableDomain } from "./url.js";

/**
 * Link extraction + cloaking detection — CommonMark-aware, ReDoS-safe.
 *
 * Defeats: links inside code spans (FP source — must mask), reference-style links
 * `[text][ref]…[ref]: url` (silent miss), bare `www.` autolinks (silent miss),
 * dangerous schemes `javascript:`/`data:`/`vbscript:`/`file:` (silent drop), defanged
 * domain mentions `paypal[.]com`/`paypal dot com` (mention-but-not-link evasion),
 * homoglyph anchor labels (handled via normalize.foldConfusables).
 *
 * All patterns use bounded character classes and quantifiers — no nested/adjacent
 * unbounded quantifiers (the catastrophic-backtracking shape).
 */

export interface LinkRef {
    href: string;
    /** Visible/anchor text; empty for a bare URL. */
    text: string;
}

const HTTP_HREF = /https?:\/\/[^\s<>()\]"']{1,2048}/i;
const HREF_CHARSET = /[^\s<>()\]"']{1,2048}/i;
// Markdown link / image: optional '!', label up to 500 chars, http(s) destination.
const MARKDOWN_LINK = /!?\[([^\]]{0,500})\]\(\s*<?(https?:\/\/[^)\s>]{1,2048})>?[^)]{0,300}\)/gi;
// Reference definition: ^[ ]{0,3}[label]: url
const REF_DEFINITION = /^[ \t]{0,3}\[([^\]]{1,200})\]:[ \t]*<?(https?:\/\/[^\s>]{1,2048})>?/gim;
// Reference usage: [text][label] or [text][] or shortcut [text]
const REF_USAGE = /\[([^\]]{0,500})\](?:\[([^\]]{0,200})\])?/g;
// Autolink <https://...>
const AUTOLINK = /<((?:https?|ftp):[^\s<>]{1,2048})>/gi;
// Bare URL (after masking code spans + already-extracted matches).
const BARE_URL = /\bhttps?:\/\/[^\s<>()\]"']{1,2048}/gi;
// Bare www.host — Reddit auto-linkifies. Bounded label repetition.
const BARE_WWW = /\bwww\.[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,8}(?:\/[^\s<>()\]"']{0,2048})?/gi;
// Dangerous schemes (anchored, fixed alternation — ReDoS-immune).
const DANGEROUS_SCHEME = /^\s*(javascript|data|vbscript|file|blob):/i;
// Markdown link/image where the href is a dangerous scheme — we want to extract these as flags.
const MARKDOWN_DANGEROUS = /!?\[([^\]]{0,500})\]\(\s*(javascript:|data:|vbscript:|file:|blob:)([^)\s]{0,2000})\)/gi;
// A domain-shaped token in *visible text* (post-normalization), for cloaking detection.
const DOMAINISH = /[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,8}/i;

/**
 * Mask code spans and fenced code blocks so links inside them are not extracted.
 * (CommonMark renders these as literal text, not links — major FP source.)
 * Replaces masked spans with spaces of equal length so offsets are preserved.
 */
function maskCode(text: string): string {
    let out = text;
    // Fenced blocks ``` ``` and ~~~ ~~~ (multi-line, bounded by closing fence).
    out = out.replace(/```[\s\S]{0,10000}?```/g, (m) => " ".repeat(m.length));
    out = out.replace(/~~~[\s\S]{0,10000}?~~~/g, (m) => " ".repeat(m.length));
    // Inline code spans: matched run of backticks of length n, content with no backticks, same-length closer.
    out = out.replace(/(`{1,8})([^`]{1,500}?)\1/g, (m) => " ".repeat(m.length));
    return out;
}

/** Extract reference-definition map: label (normalized) -> href. */
function harvestRefDefinitions(text: string): Map<string, string> {
    const defs = new Map<string, string>();
    let m: RegExpExecArray | null;
    REF_DEFINITION.lastIndex = 0;
    while ((m = REF_DEFINITION.exec(text)) !== null) {
        const label = m[1].toLowerCase().replace(/\s+/g, " ").trim();
        const href = stripTrailingPunctuation(m[2]);
        if (label && href && !defs.has(label)) defs.set(label, href);
    }
    return defs;
}

/**
 * Extract every link in (text, href) form from a Reddit/CommonMark body. De-duplicated by
 * href. Ignores links inside code spans/fences. Captures dangerous-scheme hrefs (javascript:
 * etc.) too, so downstream can flag them — these would otherwise be silently dropped.
 */
export function extractLinkRefs(input: string | undefined | null): LinkRef[] {
    if (!input) return [];
    const text = maskCode(input);
    const refs: LinkRef[] = [];
    const seen = new Set<string>();
    const push = (href: string, label: string): void => {
        const h = stripTrailingPunctuation(href);
        if (!h || seen.has(h)) return;
        seen.add(h);
        refs.push({ href: h, text: label });
    };

    // 1) Markdown links/images with http(s) hrefs.
    let m: RegExpExecArray | null;
    MARKDOWN_LINK.lastIndex = 0;
    while ((m = MARKDOWN_LINK.exec(text)) !== null) push(m[2], m[1] ?? "");

    // 2) Markdown links/images with dangerous schemes — captured for flagging.
    MARKDOWN_DANGEROUS.lastIndex = 0;
    while ((m = MARKDOWN_DANGEROUS.exec(text)) !== null) push(`${m[2]}${m[3]}`, m[1] ?? "");

    // 3) Reference-style links: harvest defs, then resolve usages.
    const defs = harvestRefDefinitions(text);
    if (defs.size > 0) {
        REF_USAGE.lastIndex = 0;
        while ((m = REF_USAGE.exec(text)) !== null) {
            const label = (m[2] || m[1]).toLowerCase().replace(/\s+/g, " ").trim();
            const href = defs.get(label);
            if (href) push(href, m[1]);
        }
    }

    // 4) Autolinks <https://…>.
    AUTOLINK.lastIndex = 0;
    while ((m = AUTOLINK.exec(text)) !== null) push(m[1], "");

    // 5) Bare URLs.
    BARE_URL.lastIndex = 0;
    while ((m = BARE_URL.exec(text)) !== null) push(m[0], "");

    // 6) Bare www. — synthesize https:// prefix.
    BARE_WWW.lastIndex = 0;
    while ((m = BARE_WWW.exec(text)) !== null) push(`https://${m[0]}`, "");

    return refs;
}

/** True if a href uses a dangerous scheme. */
export function isDangerousScheme(href: string): boolean {
    return DANGEROUS_SCHEME.test(href);
}

/** Just the hrefs (back-compat / simple callers). */
export function extractLinks(text: string | undefined | null): string[] {
    return extractLinkRefs(text).map((r) => r.href);
}

/** Registrable domain (eTLD+1) for a URL, or "" if unparseable. */
export function hrefDomain(href: string): string {
    try {
        return registrableDomain(new URL(href).hostname);
    } catch {
        return "";
    }
}

/** Unique registrable domains for a set of hrefs. */
export function domainsOf(hrefs: string[]): string[] {
    return [...new Set(hrefs.map(hrefDomain).filter(Boolean))];
}

/**
 * Cloaked = the visible text advertises a domain different from where the link actually
 * goes. Visible text is normalized + defanged first so homoglyph and "dot"-obfuscated
 * labels can't hide the mismatch.
 */
export function isCloaked(ref: LinkRef): boolean {
    if (!ref.text) return false;
    const defanged = defangDomainMentions(ref.text);
    const visMatch = normalizeForMatch(defanged).match(DOMAINISH);
    if (!visMatch) return false;
    const hrefReg = hrefDomain(ref.href);
    const visReg = registrableDomain(visMatch[0]);
    return visReg.length > 0 && hrefReg.length > 0 && visReg !== hrefReg;
}

/**
 * "Defang" domain mentions written to evade naive extractors:
 *   paypal[.]com / paypal(.)com / paypal{.}com / paypal . com / paypal dot com
 *   hxxp://… / hxxps://…
 * Used only for matching MENTIONS in prose, never for live link extraction.
 */
export function defangDomainMentions(text: string): string {
    return text
        .replace(/\bhxxps?\b/gi, (m) => m.toLowerCase().replace("xx", "tt"))
        .replace(/[\[\(\{]\s*\.\s*[\]\)\}]/g, ".")
        .replace(/(?<=[a-z0-9])\s+\.\s+(?=[a-z0-9])/gi, ".")
        .replace(/(?<=[a-z0-9])\s*\(\s*dot\s*\)\s*(?=[a-z0-9])/gi, ".")
        .replace(/(?<=[a-z0-9])\s+dot\s+(?=[a-z0-9])/gi, ".");
}

/** Items in `next` not in `prev` (set difference). */
export function newItems(prev: string[], next: string[]): string[] {
    const before = new Set(prev);
    return next.filter((x) => !before.has(x));
}

function stripTrailingPunctuation(url: string): string {
    return url.replace(/[).,!?;:'"]+$/, "");
}

// Re-export the bounded helpers so callers don't need to know the internals.
export { HREF_CHARSET, HTTP_HREF };
