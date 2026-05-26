import type { AppInstall, AppUpgrade } from "@devvit/protos";
import type { TriggerContext } from "@devvit/public-api";
import { APP_NAME } from "../config.js";

/** Set once, on first install, so upgrades don't re-send the welcome. */
const WELCOMED_KEY = "tw:meta:welcomed";

/**
 * Fires on install and upgrade. Tripwire is zero-config — sensible defaults are baked
 * into the settings — so the only onboarding is a one-time welcome modmail explaining
 * what it does and how to tune it. We gate on a Redis flag so upgrades stay silent.
 */
export async function onInstall(event: AppInstall | AppUpgrade, context: TriggerContext): Promise<void> {
    const alreadyWelcomed = await context.redis.get(WELCOMED_KEY);
    if (alreadyWelcomed) {
        console.log("[tripwire] upgrade — defaults retained, watching approvals");
        return;
    }
    await context.redis.set(WELCOMED_KEY, String(Date.now()));

    const installer = event.installer?.name;
    const greeting = installer ? `Hi u/${installer},` : "Hi mods,";

    const body = [
        greeting,
        "",
        `**${APP_NAME} is now active — and it works with zero configuration.**`,
        "",
        "Every other moderation tool acts when content is *submitted*. The moment you approve a post or comment, it becomes invisible to moderation — even if the author edits it afterward. Tripwire is the one tool that watches what happens *after* you approve.",
        "",
        "**What it does right now (defaults):**",
        "- Snapshots every post and comment your team approves.",
        "- If the author later edits it to add a new link, swap a link's destination, or substantially rewrite it, Tripwire removes it and re-queues it with a note explaining exactly what changed and who approved it.",
        "",
        "**Tune it anytime** in this app's settings on the developer platform:",
        "- *Action when content drifts*: re-queue (default), notify the approving mod, or log only.",
        "- *Sensitivity threshold*, *late-edit timing*, and *whether to watch comments too*.",
        "",
        "Every drift event is recorded so your team can review what changed.",
        "",
        "_You're all set — no further setup needed._",
    ].join("\n");

    try {
        await context.reddit.modMail.createModInboxConversation({
            subject: `${APP_NAME} is now watching your approvals`,
            bodyMarkdown: body,
            subredditId: context.subredditId,
        });
        console.log(`[tripwire] installed on r/${context.subredditName ?? context.subredditId} — welcome sent`);
    } catch (err) {
        console.error(`[tripwire] welcome modmail failed: ${String(err)}`);
    }
}
