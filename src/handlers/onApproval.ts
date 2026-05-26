import type { ModAction } from "@devvit/protos";
import type { TriggerContext } from "@devvit/public-api";
import { domainsOf, extractLinks } from "../lib/links.js";
import { writeSnapshot, type Snapshot } from "../lib/snapshot.js";

/** Mod-log action strings that mean "a moderator cleared this content". */
const APPROVE_ACTIONS = new Set(["approvelink", "approvecomment"]);

/**
 * When a moderator approves a post or comment, snapshot exactly what they approved —
 * the body, its links, and which mod approved it. This is the baseline Tripwire diffs
 * future edits against. We build the snapshot straight from the trigger payload, so no
 * extra API calls are needed.
 */
export async function onApproval(event: ModAction, context: TriggerContext): Promise<void> {
    const action = event.action ?? "";
    if (!APPROVE_ACTIONS.has(action)) return;

    const approvedBy = event.moderator?.name ?? "unknown";
    const approvedAt = Date.now();

    if (action === "approvelink" && event.targetPost) {
        const post = event.targetPost;
        const links = extractLinks(post.selftext);
        // For a link post, the post's own URL is external content that was approved too.
        if (!post.isSelf && post.url) links.push(post.url);

        const snap: Snapshot = {
            type: "post",
            title: post.title ?? "",
            body: post.selftext ?? "",
            links,
            domains: domainsOf(links),
            approvedBy,
            approvedAt,
        };
        await writeSnapshot(context, post.id, snap);
        console.log(`[tripwire] captured post ${post.id} (${links.length} links) approved by u/${approvedBy}`);
        return;
    }

    if (action === "approvecomment" && event.targetComment) {
        const comment = event.targetComment;
        const links = extractLinks(comment.body);

        const snap: Snapshot = {
            type: "comment",
            title: "",
            body: comment.body ?? "",
            links,
            domains: domainsOf(links),
            approvedBy,
            approvedAt,
        };
        await writeSnapshot(context, comment.id, snap);
        console.log(`[tripwire] captured comment ${comment.id} (${links.length} links) approved by u/${approvedBy}`);
    }
}
