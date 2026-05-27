# Tripwire

### *Moderation's rear-view mirror — catch content that turns malicious **after** you approve it.*

[![App](https://img.shields.io/badge/Devvit-tripwire--mod-FF4500?logo=reddit&logoColor=white)](https://developers.reddit.com/apps/tripwire-mod)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Tests](https://img.shields.io/badge/tests-135%20passing-brightgreen)
![Type-checked](https://img.shields.io/badge/TypeScript-strict-3178C6)
![Deterministic](https://img.shields.io/badge/runtime-deterministic%20%C2%B7%20no%20network%20%C2%B7%20no%20cost-success)

Every moderation tool on Reddit — **AutoModerator**, **Post Guidance**, **Crowd Control**,
the **Harassment Filter** — fires at *submission* time. The moment a moderator approves a
post or comment, it becomes invisible to moderation. AutoMod's own docs confirm it
*"won't act on content already approved"* and *"can't react to edits."*

That blind spot is an attack surface. The highest-leverage moment to inject a scam link is
**after** approval, once a post has climbed and every eye is on it. Tripwire is the
security camera that keeps rolling after the bouncer has let you in.

---

## The 30-second pitch

1. A user posts something perfectly fine. *"My grandma knitted this sweater for my graduation 🥹"*
2. A mod **approves** it. It hits the feed.
3. Once it's trending, the author **edits** the body to inject `…check bit.ly/sketchy-shop 💕`
4. **Within seconds, with no mod action**, Tripwire removes the post, drops it back into the queue, and modmails the team with a side-by-side diff highlighting **exactly what changed** and **which mod approved it**.

Every other tool on Reddit is structurally incapable of catching that. Tripwire is the only one that watches the post-decision timeline.

---

## What Tripwire actually does

1. **Capture** — when a moderator approves a post or comment, Tripwire snapshots what they approved (title, body, every link, every domain, which mod approved it). Built from the `ModAction` trigger payload — no extra API calls.
2. **Watch** — if the author later edits it, the `PostUpdate` / `CommentUpdate` triggers fire and Tripwire diffs the new version against the snapshot. Reddit hands us `previousBody` for free.
3. **Score** — a deterministic engine computes a "drift score" from signals that correlate with bait-and-switch abuse (full list below).
4. **Act** — above the moderator-set threshold:
   - **Re-queue** (default) — removes the content + opens a modmail thread explaining the drift in plain English with a link back to the item, and a mod note for the audit trail.
   - **Notify** — leaves the content up, but messages the team so a human decides.
   - **Log only** — records to the Drift Log dashboard for review.
5. **Review** — a moderator-only **Drift Log** custom post (created from the subreddit menu) shows every recorded drift event paginated, with a severity badge, the "what changed" signals, the post's author, the approving mod, the action taken, and one-click **View / Restore / Remove** buttons.

Zero-config — sensible defaults are baked in; the only onboarding is a one-time welcome modmail explaining what's now active and how to tune it.

---

## What the engine can defeat

Tripwire's drift scorer is **deterministic, no-network, ReDoS-safe, bounded** — built to the standard browsers and Trust-&-Safety teams use. Every defense below is implemented and unit-tested with adversarial cases.

| Attack class | How attackers evade it | What Tripwire does | Reference |
|---|---|---|---|
| **Bait-and-switch link injection** | Approve a clean post; edit-in `bit.ly/scam` once it trends | Diff hrefs vs the approved snapshot; new link → re-queue with the URL highlighted | — |
| **Domain swap** | Edit `goodsite.com/x` → `evil-lookalike.com/x` | Compare *registrable* domains (eTLD+1), not hostnames | publicsuffix.org |
| **Free-hosting swap** | `alice.github.io` → `evil.github.io` | PSL with **private section** — github.io / s3.amazonaws.com / web.app / herokuapp.com / vercel.app / pages.dev / workers.dev / blogspot.com etc. are treated as suffixes; each user is a separate org | PSL private section |
| **URL-encoding evasion** | `http://%70aypal.com`, double-encoded payloads | Google Safe Browsing canonicalization: percent-decode until stable, count passes (double-encoding = obfuscation flag) | Safe Browsing v4 spec |
| **IP-in-disguise** | `http://3627734734/`, `http://0x7f000001/`, `http://0177.0.0.01/` | Canonicalize decimal/octal/hex/dword/dotted-mixed IPv4 forms back to dotted-decimal, then flag | Safe Browsing v4 |
| **`@`-authority spoof** | `http://paypal.com@evil.ru/` (real host is after `@`) | Detect non-empty userinfo + escalate when it shape-looks like a domain | RFC 3986 |
| **Homoglyph domains** | `pаypal.com` with Cyrillic `а` | NFKD normalize → ~150-entry confusables map (Cyrillic / Greek / Armenian / Cherokee / IPA / look-alike full-stops) → skeleton compare | Unicode UTS-39 |
| **Punycode-hidden homographs** | WHATWG URL auto-encodes Cyrillic hosts as `xn--…`, hiding them from downstream string matching | Bundled RFC-3492 decoder → re-run confusable + mixed-script + typosquat on the decoded form | RFC 3492, Chromium IDN policy |
| **Mixed-script labels** | Latin + Cyrillic in one domain label | Code-point range buckets detect Latin + {Cyrillic, Greek, Armenian, Cherokee, Coptic} mix → "Highly Restrictive" fail | UTS-39 §5.2 |
| **Typosquat brands** | `paypa1.com`, `arnazon.com`, `paypal-secure.com`, `paypal.xyz`, `microsft.com` | Brand list (~50 commonly-impersonated orgs) + visual `deglyph()` (homoglyph + leet `1→l` `0→o` `5→s` + digraphs `rn→m` `vv→w` `cl→d`) + Damerau-Levenshtein with length-gated edit-distance thresholds | dnstwist, URLCrazy, Damerau 1964, Kintis CCS 2017 |
| **Link cloaking** | `[paypal.com](https://evil.ru)` — label lies about destination | Compare visible-text registrable domain vs href registrable domain after homoglyph fold AND defang pass | — |
| **Defanged mentions** | `paypal[.]com`, `paypal(.)com`, `paypal dot com`, `hxxps://…` | Recover `.` and `http(s)` from defanged forms before matching | OWASP |
| **Dangerous URL schemes** | `[click](javascript:alert(1))`, `data:` URIs | Extracted (not silently dropped) + flagged at 0.95 weight | OWASP |
| **Markdown extraction gaps (FPs)** | Links inside `` `code spans` `` falsely flagged | Mask inline code spans + fenced ```/~~~ blocks before extraction | CommonMark §6 |
| **Markdown extraction gaps (FNs)** | Reference links `[text][a]` … `[a]: url` were invisible | Harvest reference definitions + resolve full / collapsed / shortcut forms | CommonMark §4.7 |
| **Bare `www.` autolinks** | `www.evil.ru` linkified by Reddit but missed by regex | Bounded `\bwww\.…` matcher, prefixed with `https://` synthetically | Reddit / snudown |
| **Trojan Source / bidi reordering** | RTL-override chars make displayed text differ from stored — CVE-2021-42574 | Strip + flag U+202A–E, U+2066–9, U+200E/F, U+061C as an independent obfuscation signal | Boucher & Anderson 2021 |
| **Invisible-character word splitting** | `pay​pal` (zero-width inside) | Strip zero-widths, soft hyphen, BOM, word joiner, invisible operators | Unicode TR-36 |
| **Tag-character smuggling** | Invisible ASCII hidden via U+E0000-E007F | Range-strip + flag | UTS-39 |
| **Zalgo / combining-mark spoofs** | Diacritic stack hiding the real letters | NFKD decompose → strip combining-mark ranges (Mn/Mc/Me) | Unicode |
| **Off-platform solicitation (no link)** | "DM me on Telegram t.me/x", Cash App `$tags`, crypto wallets | Detect *newly-added* off-platform rails (Telegram / WhatsApp / Discord-invite / Cash App / PayPal-me / Venmo / crypto-wallet / email / generic DM solicitation) | — |
| **Filler-padding dilution** | Keep approved text intact, append a malicious sentence; symmetric Jaccard barely moves | Asymmetric **`addedFraction = |B\A|/|B|`** measures new content directly — dilution can't hide it | Broder 1997 (containment) |
| **Naive reordering false-positives** | Honest rewrites flagged because pure bigram Jaccard is brittle on short text | Blended **0.5 · unigram + 0.5 · bigram Jaccard** — reorder-robust but locally order-aware | Standard n-gram blend |
| **Wrongful auto-removal (FP asymmetry)** | Two soft signals adding up to 0.80 should not auto-remove | **Bands recalibrated 0.30 / 0.55 / 0.85** — auto-action requires one near-certain category, not two soft signals | T&S precision-first practice |

The decisions are **explained** — every drift event in the modmail and the Drift Log lists the exact human-readable signals (`"new domain not in approved version: evil.ru"`, `"brand look-alike: domain 'paypa1' is a visual look-alike of 'paypal' (paypal.com)"`, `"cloaked link: the visible text shows a different domain than where it goes"`). No mod ever sees a magic number with no reason.

---

## Architecture

```
                ┌─────────────────────────────────────────────────────────────┐
                │                       Reddit (Devvit)                        │
                │                                                              │
   approve  ──▶ │  ModAction trigger ──▶ snapshot to Redis (per-install)        │
                │                                                              │
   edit     ──▶ │  PostUpdate / CommentUpdate trigger                          │
                │       │                                                      │
                │       ▼                                                      │
                │   Drift Engine ─── canonicalize / normalize / decode         │
                │       │            extract links (CommonMark-aware)          │
                │       │            score 4 categories via noisy-OR           │
                │       │                                                      │
                │       ▼                                                      │
                │   score ≥ threshold ?                                        │
                │       │ yes                                                  │
                │       ├──▶ remove()  +  modmail (mod inbox)                  │
                │       └──▶ recordDrift() → Drift Log custom post (mod-only)  │
                │                                                              │
                │  AppInstall  ──▶ welcome modmail  +  schedule daily prune     │
                │  Scheduler   ──▶ zRemRangeByScore on the watchlist (24h)      │
                └─────────────────────────────────────────────────────────────┘
```

**Storage** is per-install-per-subreddit Redis (Reddit-hosted). Each subreddit has its own
isolated namespace — `r/gardening`'s snapshots can never touch `r/cars`'s.

**Bounded by design** — Tripwire only stores *approved* content (a small set), not the
firehose, and a scheduled prune trims watchlist entries older than the TTL (30 days). It
scales to any subreddit at zero developer cost.

---

## Project layout

```
src/
├─ main.ts                  # Devvit entry: configure, settings, triggers, custom post, menu
├─ config.ts                # Settings schema + defaults
├─ driftLogPost.tsx         # Mod-only Drift Log dashboard (Blocks)
├─ handlers/
│  ├─ onApproval.ts         # ModAction → snapshot to Redis
│  ├─ onEdit.ts             # PostUpdate / CommentUpdate → score → act
│  ├─ onInstall.ts          # Welcome modmail + schedule prune
│  └─ prune.ts              # Daily scheduled job: zRemRangeByScore
└─ lib/
   ├─ canonicalize.ts       # Safe Browsing URL canonicalization (+ IPv4 normalization)
   ├─ drift.ts              # 4-category noisy-OR scorer with calibrated bands
   ├─ driftLog.ts           # Drift event store + recent-event read
   ├─ keys.ts               # Redis key naming
   ├─ links.ts              # CommonMark-aware (text,href) extraction + cloaking + defang
   ├─ normalize.ts          # NFKD + invisible/bidi/tag strip + confusables + mixed-script
   ├─ punycode.ts           # RFC 3492 decoder (defeats WHATWG-URL auto-encoding)
   ├─ snapshot.ts           # Approved-content snapshot persistence
   ├─ solicitation.ts       # Off-platform rail detection (Telegram/Cash App/crypto/…)
   ├─ textsim.ts            # Blended Jaccard + asymmetric addedFraction
   ├─ typosquat.ts          # Brand list + deglyph + Damerau-Levenshtein
   └─ url.ts                # Risk features + PSL (ICANN + private suffixes)
```

Every `.ts` file in `lib/` is paired with a `.test.ts` of adversarial cases.

---

## Development

```bash
pnpm install
pnpm run type-check     # TypeScript strict, no errors
pnpm test               # 135 tests, all deterministic

devvit login            # one-time (verified-email Reddit account required)
devvit playtest <sub>   # live-reload to a test subreddit, streams logs

devvit publish --public --bump minor   # ship a new version for App-Directory review
```

Devvit version: `@devvit/public-api` 0.12.24 · Node 20+ · pnpm with `node-linker=hoisted`.

---

## Why this approach (and what it deliberately is *not*)

- **No AI in the critical path.** Reddit Devvit has no native LLM gateway, and the only LLM-provider domain currently allowlisted (Gemini) would require the developer to pay per call across every install — breaking the "costs nothing, can't fail at scale" guarantee. Tripwire is **100% deterministic**: every signal can be explained in a sentence, every decision is reproducible, and there is no per-call cost or external dependency. AI semantic-drift remains a documented (disclosed, opt-in, off-critical-path) roadmap item.
- **Precision-first, not recall-first.** A wrongful auto-removal is far more expensive than a missed flag that goes to a human review queue. Bands are tuned so auto-action only fires on one near-certain category, never on a sum of soft signals.
- **Transparency over magic.** Every flag has a human-readable reason. The modmail explains what changed. The Drift Log shows the diff and lets a mod restore in one click.
- **Watch only what was approved.** Tripwire's storage is bounded by a moderator's actions, not by post volume — a 10M-member sub costs the same as a 100-member sub.

---

## Status

| Phase | What shipped |
|---|---|
| ✅ 0 | Project scaffold, settings, trigger wiring |
| ✅ 1 | Capture: `ModAction` → snapshot to Redis |
| ✅ 2 | Drift scoring + re-queue action + modmail |
| ✅ 3 | Zero-config welcome modmail on install |
| ✅ 4 | Mod-only Drift Log dashboard with View / Restore / Remove |
| ✅ 5 | Scheduled prune; "watching N approved items" stat |
| ✅ 5.5 | Integrity-grade rewrite: category scoring, cloaking, solicitation, obfuscation |
| 🚫 6 | Optional AI semantic-drift — deliberately skipped (Gemini-only reachable; cost & failure-mode tradeoffs unfavorable) |
| ✅ 5.6 | FAANG-grade hardening (URL canonicalization, Trojan-Source, PSL private section, RFC-3492 punycode decoder, brand typosquat) |
| 🟡 7 | Hackathon submission assets — in progress |

Built for the **Reddit Mod Tools & Migrated Apps Hackathon (2026)**. App listing:
**https://developers.reddit.com/apps/tripwire-mod**

---

## References

- Google Safe Browsing v4 — *URLs and Hashing* canonicalization spec
- Unicode UTS-39 — *Security Mechanisms* (confusables / skeleton / restriction levels)
- Unicode UTR-36 — *Security Considerations*
- Boucher & Anderson 2021, *"Trojan Source: Invisible Vulnerabilities"* (CVE-2021-42574)
- Chromium `IDNSpoofChecker` — IDN display policy
- RFC 3492 — *Punycode* (Bootstring) decoder
- publicsuffix.org — *Public Suffix List* format + algorithm
- RFC 3986 — *URI Generic Syntax* (authority, dot-segment removal)
- Damerau 1964 / Levenshtein 1966 — edit-distance
- Kintis et al. CCS 2017 — *combosquatting*
- Broder 1997 — *resemblance vs containment* (asymmetric set similarity)
- Manku, Jain, Das Sarma 2007 — *Detecting Near-Duplicates for Web Crawling* (why SimHash is wrong for short text)
- Pearl 1988 — *Probabilistic Reasoning in Intelligent Systems* (noisy-OR)

## License

BSD-3-Clause
