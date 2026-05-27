import { Devvit, useAsync, useState } from "@devvit/public-api";
import type { Context, MenuItemOnPressEvent } from "@devvit/public-api";
import { APP_NAME } from "./config.js";
import { readRecentDrift, type DriftEvent } from "./lib/driftLog.js";
import { WATCHLIST } from "./lib/keys.js";

const PAGE_SIZE = 3;

interface DriftLogData {
    events: DriftEvent[];
    watching: number;
}

/** Mod-only dashboard: a paginated log of content that drifted after approval. */
export const DriftLog: Devvit.CustomPostComponent = (context) => {
    const [page, setPage] = useState(0);
    const [refresh, setRefresh] = useState(0);

    // useAsync requires a JSON-serializable result; a string always qualifies.
    const { data, loading } = useAsync(
        async () => {
            const events = await readRecentDrift(context, 60);
            const watching = await context.redis.zCard(WATCHLIST);
            return JSON.stringify({ events, watching } satisfies DriftLogData);
        },
        { depends: refresh },
    );
    const parsed: DriftLogData = data ? (JSON.parse(data) as DriftLogData) : { events: [], watching: 0 };
    const events = parsed.events;
    const watching = parsed.watching;

    const start = page * PAGE_SIZE;
    const pageEvents = events.slice(start, start + PAGE_SIZE);
    const hasPrev = page > 0;
    const hasNext = start + PAGE_SIZE < events.length;

    return (
        <vstack height="100%" width="100%" padding="medium" gap="small" backgroundColor="#0b1416">
            <hstack alignment="middle" gap="small" width="100%">
                <text size="large" weight="bold" color="#ffffff">{APP_NAME}</text>
                <text size="medium" color="#9aa6ab">· Drift Log</text>
                <spacer grow />
                <button size="small" appearance="secondary" onPress={() => setRefresh(refresh + 1)}>
                    Refresh
                </button>
            </hstack>

            {loading ? (
                <vstack grow alignment="middle center"><text color="#9aa6ab">Loading…</text></vstack>
            ) : events.length === 0 ? (
                <vstack grow alignment="middle center" gap="small">
                    <text size="medium" weight="bold" color="#ffffff">No drift detected 🎉</text>
                    <text size="small" color="#9aa6ab" wrap alignment="center">
                        {`Watching ${watching} approved item${watching === 1 ? "" : "s"}. Anything edited into something suspicious after approval shows up here.`}
                    </text>
                </vstack>
            ) : (
                <vstack grow gap="small" width="100%">
                    <text size="xsmall" color="#9aa6ab">
                        {`watching ${watching} approved · ${events.length} drift event${events.length === 1 ? "" : "s"} · page ${page + 1} of ${Math.max(1, Math.ceil(events.length / PAGE_SIZE))}`}
                    </text>
                    {pageEvents.map((e) => driftCard(e, context, () => setRefresh(refresh + 1)))}
                    <spacer grow />
                    <hstack gap="small" alignment="middle center" width="100%">
                        <button size="small" appearance="secondary" disabled={!hasPrev} onPress={() => setPage(page - 1)}>
                            ‹ Newer
                        </button>
                        <button size="small" appearance="secondary" disabled={!hasNext} onPress={() => setPage(page + 1)}>
                            Older ›
                        </button>
                    </hstack>
                </vstack>
            )}
        </vstack>
    );
};

function driftCard(e: DriftEvent, context: Context, onChanged: () => void) {
    const scoreColor = e.score >= 0.8 ? "#ff5c5c" : e.score >= 0.5 ? "#ffae42" : "#9aa6ab";
    const badge = e.type === "post" ? "POST" : "COMMENT";

    return (
        <vstack
            key={e.thingId}
            padding="small"
            gap="small"
            cornerRadius="medium"
            backgroundColor="#13212499"
            width="100%"
        >
            <hstack gap="small" alignment="middle">
                <text size="xsmall" weight="bold" color="#7fd1de">{badge}</text>
                <text size="xsmall" weight="bold" color={scoreColor}>{`drift ${e.score.toFixed(2)}`}</text>
                <spacer grow />
                <text size="xsmall" color="#6b7679">{timeAgo(e.detectedAt)}</text>
            </hstack>

            <text size="xsmall" color="#9aa6ab" wrap>
                {`u/${e.author} · approved by u/${e.approvedBy} · ${actionLabel(e.action)}`}
            </text>

            {e.signals.slice(0, 3).map((s, i) => (
                <text key={`${e.thingId}-sig-${i}`} size="xsmall" color="#e6edf0" wrap>{`• ${s}`}</text>
            ))}

            <hstack gap="small" alignment="middle">
                <button size="small" appearance="plain" onPress={() => context.ui.navigateTo(`https://www.reddit.com${e.permalink}`)}>
                    View
                </button>
                <button
                    size="small"
                    appearance="primary"
                    onPress={async () => {
                        await context.reddit.approve(e.thingId);
                        context.ui.showToast("Restored — content approved.");
                        onChanged();
                    }}
                >
                    Restore
                </button>
                <button
                    size="small"
                    appearance="destructive"
                    onPress={async () => {
                        await context.reddit.remove(e.thingId, false);
                        context.ui.showToast("Removed.");
                        onChanged();
                    }}
                >
                    Remove
                </button>
            </hstack>
        </vstack>
    );
}

function actionLabel(action: DriftEvent["action"]): string {
    switch (action) {
        case "requeue": return "removed & re-queued";
        case "notify": return "left up, flagged";
        default: return "logged";
    }
}

function timeAgo(ts: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

/** Menu action (mods only): create the Drift Log post in the subreddit. */
export async function createDriftLogPost(_event: MenuItemOnPressEvent, context: Context): Promise<void> {
    const subredditName = await context.reddit.getCurrentSubredditName();
    const post = await context.reddit.submitPost({
        subredditName,
        title: `${APP_NAME} — Drift Log`,
        preview: (
            <vstack height="100%" width="100%" alignment="middle center" gap="small" backgroundColor="#0b1416">
                <text size="large" weight="bold" color="#ffffff">{`${APP_NAME} — Drift Log`}</text>
                <text size="small" color="#9aa6ab">Loading drift events…</text>
            </vstack>
        ),
    });
    context.ui.showToast("Drift Log created.");
    context.ui.navigateTo(post);
}
