import type { CommentUpdate, PostUpdate } from "@devvit/protos";
import type { TriggerContext } from "@devvit/public-api";

/**
 * Fires when a post is edited. Devvit hands us `previousBody` for free, and we also
 * keep an approval-time snapshot in Redis — together these let us diff what changed.
 *
 * Phase 2 implements the diff + drift scoring + action. For now we confirm the
 * trigger fires and that the payload carries the new body and the previous body.
 */
export async function onPostEdit(event: PostUpdate, _context: TriggerContext): Promise<void> {
    const post = event.post;
    if (!post) return;
    console.log(`[tripwire] post edit: ${post.id} (prevBodyLen=${event.previousBody?.length ?? 0})`);
}

/** Fires when a comment is edited. Only acted on if "watch comments" is enabled (Phase 2). */
export async function onCommentEdit(event: CommentUpdate, _context: TriggerContext): Promise<void> {
    const comment = event.comment;
    if (!comment) return;
    console.log(`[tripwire] comment edit: ${comment.id} (prevBodyLen=${event.previousBody?.length ?? 0})`);
}
