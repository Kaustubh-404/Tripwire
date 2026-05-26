/**
 * Redis key builders. Redis is namespaced per-install-per-subreddit by Devvit,
 * so keys here are scoped to a single community automatically.
 *
 * Layout:
 *   tw:snap:{thingId}   -> hash  : snapshot of content at approval time
 *   tw:watch            -> zset  : member=thingId, score=approvedAt (for pruning)
 *   tw:drift            -> zset  : member=thingId, score=detectedAt (Drift Log order)
 *   tw:drift:{thingId}  -> hash  : a recorded drift event
 */

export const WATCHLIST = "tw:watch";
export const DRIFT_INDEX = "tw:drift";

export const snapKey = (thingId: string): string => `tw:snap:${thingId}`;
export const driftKey = (thingId: string): string => `tw:drift:${thingId}`;

/** How long to keep a snapshot of approved content before pruning (30 days). */
export const SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 30;
