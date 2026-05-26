import type { TriggerContext } from "@devvit/public-api";
import type { DriftAction } from "../config.js";
import { DRIFT_INDEX, driftKey } from "./keys.js";

/** A recorded drift event, surfaced later in the Drift Log dashboard (Phase 4). */
export interface DriftEvent {
    thingId: string;
    type: "post" | "comment";
    score: number;
    signals: string[];
    approvedBy: string;
    author: string;
    permalink: string;
    beforeExcerpt: string;
    afterExcerpt: string;
    action: DriftAction;
    detectedAt: number;
}

/** Keep at most this many recent drift events; older ones are trimmed. */
const DRIFT_LOG_MAX = 200;

export async function recordDrift(context: TriggerContext, e: DriftEvent): Promise<void> {
    await context.redis.hSet(driftKey(e.thingId), {
        type: e.type,
        score: e.score.toFixed(2),
        signals: JSON.stringify(e.signals),
        approvedBy: e.approvedBy,
        author: e.author,
        permalink: e.permalink,
        beforeExcerpt: e.beforeExcerpt,
        afterExcerpt: e.afterExcerpt,
        action: e.action,
        detectedAt: String(e.detectedAt),
    });
    await context.redis.zAdd(DRIFT_INDEX, { member: e.thingId, score: e.detectedAt });

    // Trim the index to the most recent N (drop oldest beyond the cap).
    const total = await context.redis.zCard(DRIFT_INDEX);
    if (total > DRIFT_LOG_MAX) {
        const overflow = await context.redis.zRange(DRIFT_INDEX, 0, total - DRIFT_LOG_MAX - 1);
        if (overflow.length > 0) {
            await context.redis.zRem(DRIFT_INDEX, overflow.map((m) => m.member));
            for (const m of overflow) await context.redis.del(driftKey(m.member));
        }
    }
}
