import type { TriggerContext } from "@devvit/public-api";
import { SNAPSHOT_TTL_SECONDS, WATCHLIST } from "../lib/keys.js";

/** Name of the recurring job that keeps the watchlist bounded. */
export const PRUNE_JOB = "tw-prune-watchlist";

/** Cron: once daily at 04:00 UTC. */
export const PRUNE_CRON = "0 4 * * *";

/**
 * Snapshots self-expire via their Redis TTL, but the watchlist sorted-set would grow
 * forever on a busy subreddit. This daily job removes watchlist entries older than the
 * snapshot TTL so the index stays bounded no matter the volume — "works reliably at scale".
 */
export async function pruneWatchlist(_event: unknown, context: Pick<TriggerContext, "redis">): Promise<void> {
    const cutoff = Date.now() - SNAPSHOT_TTL_SECONDS * 1000;
    const removed = await context.redis.zRemRangeByScore(WATCHLIST, 0, cutoff);
    if (removed > 0) {
        console.log(`[tripwire] pruned ${removed} expired watchlist entries`);
    }
}
