# Tripwire

**Moderation's rear-view mirror — catch content that turns malicious *after* you approve it.**

Every moderation tool on Reddit acts at submission time: AutoModerator, Post Guidance, Crowd
Control. The moment a moderator approves a post or comment, it becomes invisible to moderation —
AutoMod's own docs confirm it "won't act on content already approved" and "can't react to edits."

That blind spot is an attack surface. The highest-leverage moment to inject a scam link is *after*
approval, once a post has climbed and every eye is on it. Tripwire is the security camera that keeps
rolling after the bouncer has let you in.

## How it works

1. **Capture** — when a mod approves a post/comment, Tripwire snapshots it (title, body, links,
   domains, and which mod approved it).
2. **Watch** — if the author later edits it, Tripwire diffs the new version against the snapshot
   (and the `previousBody` Reddit provides).
3. **Score** — it computes a *drift score* from signals like *a new external link appeared*,
   *a link domain was swapped*, *the edit landed long after approval*, or *the body was rewritten*.
4. **Act** — above the moderator-set threshold, Tripwire re-queues the content with a note
   explaining exactly what changed, notifies the approving mod, or just logs it — the team's choice.
5. **Review** — a mod-only Drift Log shows every event with a before/after diff.

Zero-config: sensible defaults mean it works the moment it's installed.

## Built on Devvit

- `ModAction` trigger — capture approvals + the approving moderator
- `PostUpdate` / `CommentUpdate` triggers — detect edits (with `previousBody`)
- Redis — snapshots + a prunable watchlist; only approved content is stored, never the firehose
- Reddit API — `remove`, `addRemovalNote`, modmail
- Settings — per-sub action mode, sensitivity threshold, timing, comment-watching

## Status

Built phase-by-phase for the Reddit Mod Tools & Migrated Apps Hackathon. See `docs/planning/` for
design notes.

| Phase | Scope |
|-------|-------|
| 0 | Scaffold, settings, trigger wiring |
| 1 | Capture approved content to Redis |
| 2 | Diff + drift scoring + re-queue action |
| 3 | Settings polish + zero-config onboarding |
| 4 | Drift Log dashboard (mod-only post) |
| 5 | Presets, accountability mode, scale hardening |
| 6 | Optional disclosed AI semantic-drift check |

## Develop

```bash
npm install
npm run type-check
devvit login            # one-time, interactive
devvit playtest <your-test-subreddit>
```
