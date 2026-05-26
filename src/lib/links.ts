/**
 * Link + domain extraction utilities.
 *
 * Tripwire's strongest drift signals are "a new external link appeared" and "a link's
 * domain was swapped". These helpers extract URLs from both markdown link syntax and
 * raw URLs in text, then normalize their hostnames for comparison.
 */

// Matches markdown links [text](url) and bare http(s) URLs.
const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
const BARE_URL = /\bhttps?:\/\/[^\s<>()\]"']+/gi;

/** Extract a de-duplicated list of URLs from a block of text. */
export function extractLinks(text: string | undefined | null): string[] {
    if (!text) return [];
    const found = new Set<string>();
    let m: RegExpExecArray | null;

    MARKDOWN_LINK.lastIndex = 0;
    while ((m = MARKDOWN_LINK.exec(text)) !== null) {
        found.add(stripTrailingPunctuation(m[1]));
    }
    BARE_URL.lastIndex = 0;
    while ((m = BARE_URL.exec(text)) !== null) {
        found.add(stripTrailingPunctuation(m[0]));
    }
    return [...found];
}

/** Normalize a URL to its registrable-ish hostname (lowercased, no leading www.). */
export function domainOf(url: string): string {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host.startsWith("www.") ? host.slice(4) : host;
    } catch {
        return "";
    }
}

/** Unique, normalized set of domains for a list of URLs. */
export function domainsOf(urls: string[]): string[] {
    return [...new Set(urls.map(domainOf).filter(Boolean))];
}

/** Items in `next` that are not in `prev` (set difference). */
export function newItems(prev: string[], next: string[]): string[] {
    const before = new Set(prev);
    return next.filter((x) => !before.has(x));
}

// URLs in prose often end with a stray ) . , ! that isn't part of the link.
function stripTrailingPunctuation(url: string): string {
    return url.replace(/[).,!?;:'"]+$/, "");
}
