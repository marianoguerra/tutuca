// What the panel UI components (and the storybook's) share: card styles, step badges, buttons and the "story" ask.
import { $if, button, field, send } from "../../tutuca.js";

// The card a story's app shows in, and a panel's: the same, its parts in a column.
export const appCard = "card border border-base-300 bg-base-100 p-4 shadow-sm";
export const card = `${appCard} flex flex-col gap-3`;
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
export const smallButton = (attrs, ...children) =>
	button({ class: "btn btn-sm", ...attrs }, ...children);

// The query that says whether the tab or panel name shows: isSteps for steps.
export const isShown = (name) => `is${name[0].toUpperCase()}${name.slice(1)}`;
// A daisyUI tab for name that sends message with name; it's active while the component's
// is<Name> getter is true.
export const tabButton = (message, name, label, ...children) =>
	button(
		{
			role: "tab",
			class: $if(field(isShown(name)), "tab tab-active", "tab"),
			"on:click": send(message, name),
		},
		label,
		...children,
	);
