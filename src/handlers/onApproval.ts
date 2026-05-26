import type { ModAction } from "@devvit/protos";
import type { TriggerContext } from "@devvit/public-api";

/** Mod-log action strings that mean "a moderator cleared this content". */
const APPROVE_ACTIONS = new Set(["approvelink", "approvecomment"]);

/**
 * Fires on every mod action. We only care about approvals: when a mod approves a
 * post or comment, we snapshot what they approved so we can later detect drift.
 *
 * Phase 1 implements the snapshot. For now we confirm the trigger fires and that
 * the payload carries the action type and the approving moderator.
 */
export async function onApproval(event: ModAction, _context: TriggerContext): Promise<void> {
    const action = event.action ?? "";
    if (!APPROVE_ACTIONS.has(action)) return;

    const targetId = event.targetPost?.id ?? event.targetComment?.id;
    console.log(`[tripwire] approval: action=${action} target=${targetId} by=u/${event.moderator?.name}`);
}
