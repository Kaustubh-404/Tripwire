import type { CommentUpdate, PostUpdate } from "@devvit/protos";
import type { TriggerContext } from "@devvit/public-api";
import { DEFAULTS, SETTING, type DriftAction } from "../config.js";
import { scoreDrift } from "../lib/drift.js";
import { recordDrift } from "../lib/driftLog.js";
import { domainsOf, extractLinks } from "../lib/links.js";
import { readSnapshot } from "../lib/snapshot.js";

/** Normalized view of an edited thing, shared by the post and comment handlers. */
interface EditInfo {
    thingId: string;
    type: "post" | "comment";
    currentBody: string;
    currentLinks: string[];
    subredditId?: string;
    author: string;
    permalink: string;
}

/**
 * The heart of Tripwire. Look up what was approved; if this thing was never approved by
 * a mod, it isn't watched — ignore. Otherwise score how far it drifted, and if it's over
 * the moderator's threshold, take the configured action and record it to the Drift Log.
 */
async function evaluateAndRespond(info: EditInfo, context: TriggerContext): Promise<void> {
    const snap = await readSnapshot(context, info.thingId);
    if (!snap) return; // never mod-approved → not watched

    const settings = await context.settings.getAll();
    const mode = ((settings[SETTING.mode] as string[] | undefined)?.[0] as DriftAction) ?? DEFAULTS.mode;
    const threshold = (settings[SETTING.threshold] as number | undefined) ?? DEFAULTS.threshold;
    const lateEditHours = (settings[SETTING.lateEditHours] as number | undefined) ?? DEFAULTS.lateEditHours;

    const result = scoreDrift({
        approvedLinks: snap.links,
        approvedDomains: snap.domains,
        approvedBody: snap.body,
        currentLinks: info.currentLinks,
        currentDomains: domainsOf(info.currentLinks),
        currentBody: info.currentBody,
        minutesSinceApproval: (Date.now() - snap.approvedAt) / 60000,
        lateEditHours,
    });

    if (result.score < threshold) return;

    await recordDrift(context, {
        thingId: info.thingId,
        type: info.type,
        score: result.score,
        signals: result.signals,
        approvedBy: snap.approvedBy,
        author: info.author,
        permalink: info.permalink,
        beforeExcerpt: snap.body.slice(0, 300),
        afterExcerpt: info.currentBody.slice(0, 300),
        action: mode,
        detectedAt: Date.now(),
    });

    if (mode === "requeue") {
        await context.reddit.remove(info.thingId, false);
    }
    if (mode === "requeue" || mode === "notify") {
        await notifyMods(context, info, snap.approvedBy, result.score, result.signals, mode);
    }

    console.log(`[tripwire] drift ${result.score.toFixed(2)} on ${info.thingId} → ${mode} (${result.signals.join("; ")})`);
}

async function notifyMods(
    context: TriggerContext,
    info: EditInfo,
    approvedBy: string,
    score: number,
    signals: string[],
    mode: DriftAction,
): Promise<void> {
    if (!info.subredditId) return;
    const verb = mode === "requeue" ? "has been removed and re-queued for review" : "is still live and flagged for review";
    const body = [
        `**Tripwire — approved content drifted (score ${score.toFixed(2)})**`,
        "",
        `A ${info.type} by u/${info.author}, approved by u/${approvedBy}, changed after approval and ${verb}.`,
        "",
        "**What changed:**",
        ...signals.map((s) => `- ${s}`),
        "",
        `[View the ${info.type}](https://www.reddit.com${info.permalink})`,
    ].join("\n");

    try {
        await context.reddit.modMail.createModInboxConversation({
            subject: `Tripwire: ${info.type} drifted after approval`,
            bodyMarkdown: body,
            subredditId: info.subredditId,
        });
    } catch (err) {
        console.error(`[tripwire] modmail notify failed: ${String(err)}`);
    }
}

export async function onPostEdit(event: PostUpdate, context: TriggerContext): Promise<void> {
    const post = event.post;
    if (!post) return;
    const links = extractLinks(post.selftext);
    // A link post's own URL is external content the mod approved too.
    if (!post.isSelf && post.url) links.push(post.url);

    await evaluateAndRespond(
        {
            thingId: post.id,
            type: "post",
            currentBody: post.selftext ?? "",
            currentLinks: links,
            subredditId: event.subreddit?.id,
            author: event.author?.name ?? "unknown",
            permalink: post.permalink ?? "",
        },
        context,
    );
}

export async function onCommentEdit(event: CommentUpdate, context: TriggerContext): Promise<void> {
    const watch = (await context.settings.get(SETTING.watchComments)) as boolean | undefined;
    if (!watch) return;

    const comment = event.comment;
    if (!comment) return;

    await evaluateAndRespond(
        {
            thingId: comment.id,
            type: "comment",
            currentBody: comment.body ?? "",
            currentLinks: extractLinks(comment.body),
            subredditId: event.subreddit?.id,
            author: comment.author ?? event.author?.name ?? "unknown",
            permalink: comment.permalink ?? "",
        },
        context,
    );
}
