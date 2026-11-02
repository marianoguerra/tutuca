// What the storybook UI components share: card styles, step badges, buttons and the "story" ask.
import { $if, button, field, send } from "../../tutuca.js";

export const card = "card border border-base-300 bg-base-100 p-4 shadow-sm flex flex-col gap-3";
export const title = "text-sm font-semibold uppercase tracking-wider text-base-content/60";
export const BADGES = {
	pending: "badge badge-sm badge-ghost",
	ok: "badge badge-sm badge-success",
	failed: "badge badge-sm badge-error",
	skipped: "badge badge-sm badge-warning",
};

// Asks the StoryRunner of self's app to run op.
export const askStory = (ctx, self, op, ...args) => ctx.ask("story", [self.appKey, op, ...args]);

// A small daisyUI button; class adds to btn btn-sm unless attrs replace it.
export const smallButton = (attrs, ...childs) =>
	button({ class: "btn btn-sm", ...attrs }, ...childs);

// A daisyUI tab for name that sends message with name; it's active while the component's
// is<Name> getter is true.
export const tabButton = (message, name, label, ...childs) =>
	button(
		{
			role: "tab",
			class: $if(field(`is${name[0].toUpperCase()}${name.slice(1)}`), "tab tab-active", "tab"),
			"on:click": send(message, name),
		},
		label,
		...childs,
	);
