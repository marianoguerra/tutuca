// What the storybook UI components share: card styles, step badges, buttons and the "story" ask.
import { button } from "../../tutuca.js";

export const card = "card border border-base-300 bg-base-100 p-4 shadow-sm flex flex-col gap-3";
export const title = "text-sm font-semibold uppercase tracking-wider text-base-content/60";
export const BADGES = {
	pending: "badge badge-sm badge-ghost",
	ok: "badge badge-sm badge-success",
	failed: "badge badge-sm badge-error",
	skipped: "badge badge-sm badge-warning",
};
export const ORIGINS = { initial: "◆", reload: "↻", step: "▸", user: "☝" };

// Asks the StoryRunner of self's app to run op.
export const askStory = (ctx, self, op, ...args) => ctx.ask("story", [self.appKey, op, ...args]);

// A small daisyUI button; class adds to btn btn-sm unless attrs replace it.
export const smallButton = (attrs, ...childs) =>
	button({ class: "btn btn-sm", ...attrs }, ...childs);

// A stress panel before any run, and the shape of a run's progress.
export const STRESS_IDLE = { status: "idle", done: 0, total: 0, error: "", commands: [], log: [] };
// Lines of the stress run log kept, the latest ones.
export const STRESS_LOG_MAX = 1000;
