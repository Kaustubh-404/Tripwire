/**
 * URL canonicalization — Google Safe Browsing v4 spec, adapted.
 *
 * Run every URL through this BEFORE feature extraction. Defeats encoding evasion:
 * `http://%70aypal.com`, `http://paypal%2ecom`, `http://3627734734/` (decimal IP),
 * `http://0xd8.0x3a.0xfd.0x4e/` (hex IP), `http://0330.072.0375.0116/` (octal IP) all
 * normalize to a stable, comparable form.
 *
 * Reference: Google Safe Browsing "URLs and Hashing" canonicalization algorithm.
 * Pure, deterministic, bounded time, ReDoS-safe (only anchored fixed-class regex).
 */

const MAX_URL_LENGTH = 4096;
const MAX_DECODE_PASSES = 10;

/** Tab/CR/LF inside a URL are an evasion vector — strip before parsing. */
function stripUrlWhitespace(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c !== 0x09 && c !== 0x0a && c !== 0x0d) out += s[i];
    }
    return out;
}

/** Percent-decode repeatedly until a pass changes nothing. Returns [decoded, passes]. */
function repeatedPercentDecode(s: string): [string, number] {
    let current = s;
    let passes = 0;
    for (let i = 0; i < MAX_DECODE_PASSES; i++) {
        let next: string;
        try {
            next = decodeURIComponent(current);
        } catch {
            return [current, passes];
        }
        if (next === current) break;
        current = next;
        passes++;
    }
    return [current, passes];
}

/** RFC 3986 dot-segment removal for paths. */
function removeDotSegments(path: string): string {
    const out: string[] = [];
    for (const seg of path.split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") { out.pop(); continue; }
        out.push(seg);
    }
    // Preserve leading '/' and a trailing '/' from the input.
    const lead = path.startsWith("/") ? "/" : "";
    const trail = path.length > 1 && path.endsWith("/") ? "/" : "";
    return lead + out.join("/") + trail;
}

/**
 * Try to interpret a hostname as an IPv4 in any of the abused encodings: dotted decimal,
 * single decimal, hex (0x...), octal (leading 0), or mixed-radix dotted. Returns the
 * canonical dotted-decimal form, or null if it isn't an IPv4 in disguise.
 */
export function canonicalizeIPv4(host: string): string | null {
    const trimmed = host.replace(/\.+$/, "");
    if (trimmed.length === 0) return null;

    // Single integer (dword) form: 0..2^32-1 in dec/hex/octal.
    if (/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(trimmed) && !trimmed.includes(".")) {
        const n = parseRadixInt(trimmed);
        if (n === null || n < 0 || n > 0xffffffff) return null;
        return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
    }

    // Dotted form: each part may be dec/hex/octal; 1..4 parts (browsers allow short forms).
    const parts = trimmed.split(".");
    if (parts.length < 2 || parts.length > 4) return null;
    const nums: number[] = [];
    for (const p of parts) {
        if (!/^(0x[0-9a-f]+|0[0-7]*|\d+)$/i.test(p)) return null;
        const n = parseRadixInt(p);
        if (n === null || n < 0) return null;
        nums.push(n);
    }
    // The last part absorbs the remaining bytes (RFC 3986 quirk used by browsers).
    const last = nums[nums.length - 1];
    const limits = [256, 65536, 16777216, 4294967296];
    if (last >= limits[4 - nums.length]) return null;
    for (let i = 0; i < nums.length - 1; i++) if (nums[i] > 0xff) return null;

    const octets = new Array(4).fill(0);
    for (let i = 0; i < nums.length - 1; i++) octets[i] = nums[i];
    let rem = last;
    for (let i = 3; i >= nums.length - 1; i--) {
        octets[i] = rem & 0xff;
        rem = Math.floor(rem / 256);
    }
    return octets.join(".");
}

function parseRadixInt(s: string): number | null {
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(s)) n = parseInt(s.slice(2), 16);
    else if (/^0[0-7]+$/.test(s)) n = parseInt(s, 8);
    else if (/^\d+$/.test(s)) n = parseInt(s, 10);
    else return null;
    return Number.isFinite(n) ? n : null;
}

export interface CanonicalUrl {
    /** Canonical URL string, suitable for display/storage. */
    href: string;
    /** Lowercased host, IPv4-normalized if applicable. */
    hostname: string;
    /** RFC-3986-normalized path (always starts with '/'). */
    pathname: string;
    /** Query string without the leading '?'. */
    search: string;
    /** Scheme without ':' (e.g. 'https'). */
    scheme: string;
    /** Username portion of authority (empty if none) — the '@'-trick signal. */
    username: string;
    /** True if the host was an IP-in-disguise (decimal/octal/hex). */
    isIpHost: boolean;
    /** Decode pass count > 1 means double-encoding was used (obfuscation signal). */
    decodePasses: number;
}

/**
 * Canonicalize a URL string per the Safe Browsing algorithm:
 * strip tab/CR/LF -> drop fragment -> percent-decode until stable -> parse ->
 * lowercase + IPv4-normalize host -> normalize path (dot-segments, '//' -> '/') -> rebuild.
 * Returns null if the input is not parseable as an http(s)/ftp URL.
 */
export function canonicalizeUrl(raw: string): CanonicalUrl | null {
    if (!raw || raw.length > MAX_URL_LENGTH) return null;
    let s = stripUrlWhitespace(raw).trim();
    const hashIdx = s.indexOf("#");
    if (hashIdx >= 0) s = s.slice(0, hashIdx);

    const [decoded, decodePasses] = repeatedPercentDecode(s);

    let url: URL;
    try {
        url = new URL(decoded);
    } catch {
        return null;
    }
    const scheme = url.protocol.replace(/:$/, "").toLowerCase();

    let hostname = url.hostname.toLowerCase().replace(/\.+/g, ".").replace(/^\.|\.$/g, "");
    const ipv4 = canonicalizeIPv4(hostname);
    const isIpHost = ipv4 !== null || hostname.startsWith("[") || hostname.includes(":");
    if (ipv4) hostname = ipv4;

    let pathname = url.pathname || "/";
    pathname = pathname.replace(/\/{2,}/g, "/");
    pathname = removeDotSegments(pathname);
    if (pathname === "") pathname = "/";

    const search = url.search.replace(/^\?/, "");
    const href = `${scheme}://${url.username ? url.username + (url.password ? ":" + url.password : "") + "@" : ""}${hostname}${url.port ? ":" + url.port : ""}${pathname}${search ? "?" + search : ""}`;

    return {
        href,
        hostname,
        pathname,
        search,
        scheme,
        username: url.username,
        isIpHost,
        decodePasses,
    };
}
