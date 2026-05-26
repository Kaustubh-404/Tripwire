import type { SettingsFormField } from "@devvit/public-api";

/** Human-facing app name, used in mod notes and modmail. */
export const APP_NAME = "Tripwire";

/** Setting keys. Keep these stable — they are the storage keys for installer config. */
export const SETTING = {
    mode: "driftAction",
    threshold: "driftThreshold",
    lateEditHours: "lateEditHours",
    watchComments: "watchComments",
} as const;

/** What Tripwire does when content drifts after approval. */
export type DriftAction = "requeue" | "notify" | "log";

/** Fallback defaults, used if a setting is somehow unset. Mirror the defaults below. */
export const DEFAULTS = {
    mode: "requeue" as DriftAction,
    threshold: 0.5,
    lateEditHours: 0,
    watchComments: false,
};

export const appSettings: SettingsFormField[] = [
    {
        type: "select",
        name: SETTING.mode,
        label: "When approved content drifts, Tripwire should…",
        helpText:
            "Re-queue removes the content and sends it back to the queue with a note explaining what changed. Notify leaves it up but messages the mod who approved it. Log only records it in the Drift Log.",
        options: [
            { label: "Re-queue it (remove + mod note)", value: "requeue" },
            { label: "Notify the approving mod only", value: "notify" },
            { label: "Log only (no action taken)", value: "log" },
        ],
        defaultValue: ["requeue"],
        multiSelect: false,
    },
    {
        type: "number",
        name: SETTING.threshold,
        label: "Drift sensitivity threshold (0.0 – 1.0)",
        helpText:
            "Content scoring at or above this value is treated as drifted. Lower = more sensitive. Default 0.5. A newly-added external link alone scores 0.6.",
        defaultValue: 0.5,
    },
    {
        type: "number",
        name: SETTING.lateEditHours,
        label: "Flag edits made more than N hours after approval",
        helpText:
            "Honest typo fixes usually happen within minutes; bait-and-switch edits often happen later. Set 0 to ignore timing.",
        defaultValue: 0,
    },
    {
        type: "boolean",
        name: SETTING.watchComments,
        label: "Also watch approved comments (not just posts)",
        helpText: "Comments are edited far more often than posts; enable only if your community needs it.",
        defaultValue: false,
    },
];
