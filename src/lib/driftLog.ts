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

/** Read recent drift events, most recent first, for the Drift Log dashboard. */
export async function readRecentDrift(
    context: Pick<TriggerContext, "redis">,
    limit = 25,
): Promise<DriftEvent[]> {
    const members = await context.redis.zRange(DRIFT_INDEX, 0, -1);
    const ids = members
        .map((m) => m.member)
        .reverse() // zRange is ascending by detectedAt; newest first for display
        .slice(0, limit);

    const events: DriftEvent[] = [];
    for (const id of ids) {
        const h = await context.redis.hGetAll(driftKey(id));
        if (!h || !h.detectedAt) continue;
        events.push({
            thingId: id,
            type: h.type === "comment" ? "comment" : "post",
            score: Number(h.score) || 0,
            signals: safeParseArray(h.signals),
            approvedBy: h.approvedBy ?? "unknown",
            author: h.author ?? "unknown",
            permalink: h.permalink ?? "",
            beforeExcerpt: h.beforeExcerpt ?? "",
            afterExcerpt: h.afterExcerpt ?? "",
            action: (h.action as DriftAction) ?? "log",
            detectedAt: Number(h.detectedAt) || 0,
        });
    }
    return events;
}

function safeParseArray(s: string | undefined): string[] {
    if (!s) return [];
    try {
        const v = JSON.parse(s);
        return Array.isArray(v) ? (v as string[]) : [];
    } catch {
        return [];
    }
}
