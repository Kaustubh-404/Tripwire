import type { AppInstall, AppUpgrade } from "@devvit/protos";
import type { TriggerContext } from "@devvit/public-api";

/**
 * Fires when the app is installed or upgraded on a subreddit. Tripwire is zero-config:
 * sensible defaults are baked into the settings, so it works the moment it's installed.
 *
 * Phase 3 sends a welcome modmail explaining what Tripwire does and how to tune it.
 */
export async function onInstall(_event: AppInstall | AppUpgrade, _context: TriggerContext): Promise<void> {
    console.log("[tripwire] installed/upgraded — defaults active, watching approvals");
}
