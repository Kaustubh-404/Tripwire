/**
 * Minimal RFC 3492 (Punycode) decoder.
 *
 * WHATWG `URL` auto-encodes Unicode hostnames as `xn--…` IDNs, hiding homograph attacks
 * from downstream string-matching. We decode the label back to its Unicode form so the
 * typosquat detector and mixed-script check can see what the attacker actually wrote.
 *
 * Pure, deterministic, bounded — operates label-at-a-time on short strings.
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
    let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
    d += Math.floor(d / numPoints);
    let k = 0;
    while (d > ((BASE - TMIN) * TMAX) >> 1) {
        d = Math.floor(d / (BASE - TMIN));
        k += BASE;
    }
    return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

function decodeDigit(cp: number): number {
    if (cp >= 48 && cp <= 57) return cp - 22; // '0'-'9' -> 26-35
    if (cp >= 65 && cp <= 90) return cp - 65; // 'A'-'Z' -> 0-25
    if (cp >= 97 && cp <= 122) return cp - 97; // 'a'-'z' -> 0-25
    return BASE;
}

/** Decode a single punycode label (without the `xn--` prefix). Returns null on malformed input. */
export function punycodeDecodeLabel(input: string): string | null {
    if (input.length > 256) return null;
    const lastDash = input.lastIndexOf("-");
    let output: string;
    let pos: number;
    if (lastDash > 0) {
        for (let i = 0; i < lastDash; i++) {
            if (input.charCodeAt(i) >= 0x80) return null;
        }
        output = input.slice(0, lastDash);
        pos = lastDash + 1;
    } else {
        output = "";
        pos = 0;
    }

    let n = INITIAL_N;
    let bias = INITIAL_BIAS;
    let i = 0;
    while (pos < input.length) {
        const oldi = i;
        let w = 1;
        for (let k = BASE; ; k += BASE) {
            if (pos >= input.length) return null;
            const digit = decodeDigit(input.charCodeAt(pos++));
            if (digit >= BASE) return null;
            if (digit > Math.floor((MAX_INT - i) / w)) return null;
            i += digit * w;
            const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
            if (digit < t) break;
            if (w > Math.floor(MAX_INT / (BASE - t))) return null;
            w *= BASE - t;
        }
        const out = [...output].length + 1;
        bias = adapt(i - oldi, out, oldi === 0);
        if (Math.floor(i / out) > MAX_INT - n) return null;
        n += Math.floor(i / out);
        i %= out;
        const chars = [...output];
        chars.splice(i, 0, String.fromCodePoint(n));
        output = chars.join("");
        i++;
    }
    return output;
}

/** Decode `xn--...`-prefixed labels in a hostname back to Unicode; leave others alone. */
export function decodeHostname(host: string): string {
    return host
        .split(".")
        .map((label) => {
            if (!label.toLowerCase().startsWith("xn--")) return label;
            const decoded = punycodeDecodeLabel(label.slice(4));
            return decoded ?? label;
        })
        .join(".");
}
