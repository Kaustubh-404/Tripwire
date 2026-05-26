import { Devvit } from "@devvit/public-api";
import { appSettings } from "./config.js";
import { createDriftLogPost, DriftLog } from "./driftLogPost.js";
import { onApproval } from "./handlers/onApproval.js";
import { onCommentEdit, onPostEdit } from "./handlers/onEdit.js";
import { onInstall } from "./handlers/onInstall.js";

Devvit.configure({
    redditAPI: true,
    redis: true,
});

Devvit.addSettings(appSettings);

// Capture: snapshot content when a mod approves it.
Devvit.addTrigger({ event: "ModAction", onEvent: onApproval });

// Watch: detect drift when approved content is later edited.
Devvit.addTrigger({ event: "PostUpdate", onEvent: onPostEdit });
Devvit.addTrigger({ event: "CommentUpdate", onEvent: onCommentEdit });

// Onboard: zero-config defaults on install/upgrade.
Devvit.addTrigger({ events: ["AppInstall", "AppUpgrade"], onEvent: onInstall });

// Review: a mod-only Drift Log dashboard, created from the subreddit menu.
Devvit.addCustomPostType({
    name: "Tripwire Drift Log",
    description: "Post-approval drift events for moderators",
    height: "tall",
    render: DriftLog,
});

Devvit.addMenuItem({
    label: "Tripwire: open Drift Log",
    location: "subreddit",
    forUserType: "moderator",
    onPress: createDriftLogPost,
});

export default Devvit;
