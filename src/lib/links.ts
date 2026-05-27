import { normalizeForMatch } from "./normalize.js";
import { registrableDomain } from "./url.js";

/**
 * Link extraction + cloaking detection.
 *
 * We extract links as (visible text, href) pairs, not just URLs, because the single most
 * valuable phishing signal is *cloaking*: a markdown link whose visible text advertises one
 * domain while the href points somewhere else — [paypal.com](https://evil-phish.ru). Visible
 * text is normalized first so homoglyph spoofing in the label doesn't hide the mismatch.
 *
 * Regexes use bounded character classes only (ReDoS-safe).
 */

export interface LinkRef {
    href: string;
    /** The visible/anchor text for a markdown link; empty for a bare URL. */
    text: string;
}

const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
const BARE_URL = /\bhttps?:\/\/[^\s<>()\]"']+/gi;
// A token containing a dot, e.g. "paypal.com" — bounded, ReDoS-safe.
const DOMAINISH = /[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

/** Extract de-duplicated links as (text, href) pairs. */
export function extractLinkRefs(text: string | undefined | null): LinkRef[] {
    if (!text) return [];
    const refs: LinkRef[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;

    MARKDOWN_LINK.lastIndex = 0;
    while ((m = MARKDOWN_LINK.exec(text)) !== null) {
        const href = stripTrailingPunctuation(m[2]);
        if (!seen.has(href)) {
            seen.add(href);
            refs.push({ href, text: m[1] ?? "" });
        }
    }
    BARE_URL.lastIndex = 0;
    while ((m = BARE_URL.exec(text)) !== null) {
        const href = stripTrailingPunctuation(m[0]);
        if (!seen.has(href)) {
            seen.add(href);
            refs.push({ href, text: "" });
        }
    }
    return refs;
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
 * goes. Visible text is normalized first so homoglyph labels can't hide the mismatch.
 */
export function isCloaked(ref: LinkRef): boolean {
    if (!ref.text) return false;
    const visMatch = normalizeForMatch(ref.text).match(DOMAINISH);
    if (!visMatch) return false;
    const hrefReg = hrefDomain(ref.href);
    const visReg = registrableDomain(visMatch[0]);
    return visReg.length > 0 && hrefReg.length > 0 && visReg !== hrefReg;
}

/** Items in `next` not in `prev` (set difference). */
export function newItems(prev: string[], next: string[]): string[] {
    const before = new Set(prev);
    return next.filter((x) => !before.has(x));
}

function stripTrailingPunctuation(url: string): string {
    return url.replace(/[).,!?;:'"]+$/, "");
}
