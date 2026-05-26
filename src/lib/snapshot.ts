import type { TriggerContext } from "@devvit/public-api";
import { SNAPSHOT_TTL_SECONDS, WATCHLIST, snapKey } from "./keys.js";

/** What a moderator approved, captured at approval time so we can detect later drift. */
export interface Snapshot {
    type: "post" | "comment";
    title: string;
    body: string;
    links: string[];
    domains: string[];
    approvedBy: string;
    approvedAt: number;
}

/** Persist a snapshot and add the thing to the prunable watchlist. */
export async function writeSnapshot(context: TriggerContext, thingId: string, snap: Snapshot): Promise<void> {
    await context.redis.hSet(snapKey(thingId), {
        type: snap.type,
        title: snap.title,
        body: snap.body,
        links: JSON.stringify(snap.links),
        domains: JSON.stringify(snap.domains),
        approvedBy: snap.approvedBy,
        approvedAt: String(snap.approvedAt),
    });
    await context.redis.expire(snapKey(thingId), SNAPSHOT_TTL_SECONDS);
    await context.redis.zAdd(WATCHLIST, { member: thingId, score: snap.approvedAt });
}

/** Read a snapshot back, or null if this thing was never approved (so never watched). */
export async function readSnapshot(context: TriggerContext, thingId: string): Promise<Snapshot | null> {
    const h = await context.redis.hGetAll(snapKey(thingId));
    if (!h || !h.approvedAt) return null;
    return {
        type: h.type === "comment" ? "comment" : "post",
        title: h.title ?? "",
        body: h.body ?? "",
        links: safeParseArray(h.links),
        domains: safeParseArray(h.domains),
        approvedBy: h.approvedBy ?? "unknown",
        approvedAt: Number(h.approvedAt),
    };
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
