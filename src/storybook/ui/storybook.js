// The storybook root: the sidebar of stories and the panels of the selected one.

import {
	$if,
	apply,
	component,
	field,
	render,
	renderEach,
	send,
	t,
	tag,
	targetValue,
} from "../../tutuca.js";
import { smallButton, tabButton } from "./common.js";
import { panelFields, panelHandlers, resetPanels, storyApp, withPanelQueries } from "./panels.js";

const { aside, div, h1, h2, input, main, p, section, span, ul } = tag;

export const Storybook = component({
	name: "Storybook",
	fields: {
		links: t.array(t.component("StoryLink")),
		filterText: t.string(),
		collapsed: t.array(t.string()), // Groups whose stories are hidden.
		selectedId: t.string(),
		isGenerated: t.boolean(),
		seed: t.number().int().min(0),
		panel: t.enum("steps", "stress", "dev"),
		...panelFields,
	},
	queries: withPanelQueries("panel", {
		get appKey() {
			return `${this.selectedId}@${this.seed}`;
		},
		get hasStory() {
			return this.selectedId !== "";
		},
	}),
	loops: {
		// Collapsed groups keep their header, on their first link.
		links: {
			filter(_index, link) {
				return link.matches(this.filterText) && (link.showGroup || !link.isCollapsed);
			},
		},
	},
	// The sidebar and the story scroll on their own, so a long list keeps the story in view.
	view: div(
		{
			class:
				"grid min-h-screen grid-cols-1 bg-base-200 text-base-content md:h-screen md:grid-cols-[16rem_1fr] md:overflow-hidden",
		},
		aside(
			{ class: "flex flex-col gap-3 border-r border-base-300 bg-base-100 p-4 md:overflow-y-auto" },
			h1({ class: "text-lg font-bold" }, "Tutuca Storybook"),
			input({
				class: "input input-sm input-bordered w-full",
				placeholder: "Filter stories…",
				"aria-label": "Filter stories",
				value: field("filterText"),
				"on:input": send("setFilterText", targetValue()),
			}),
			ul({ class: "flex flex-col gap-1" }, renderEach(field("links"), "links")),
		),
		main(
			{ class: "flex min-w-0 flex-col gap-4 p-4 md:overflow-y-auto", "data-story-main": "" },
			$if(
				field("hasStory"),
				div(
					{ class: "flex flex-col gap-4" },
					div(
						{ class: "flex flex-wrap items-center gap-3" },
						h2({ class: "text-xl font-bold" }, field("selectedId")),
						$if(
							field("isGenerated"),
							div(
								{ class: "flex items-center gap-2" },
								span({ class: "badge badge-outline" }, "seed ", field("seed")),
								smallButton({ "on:click": send("reroll") }, "Reroll"),
							),
							"",
						),
					),
					section({ class: "card border border-base-300 bg-base-100 p-4 shadow-sm" }, storyApp()),
					div(
						{ role: "tablist", class: "tabs tabs-box self-start" },
						tabButton("setPanel", "steps", "Steps"),
						tabButton("setPanel", "stress", "Stress test"),
						tabButton("setPanel", "dev", "Dev"),
					),
					$if(
						field("isSteps"),
						render(field("story")),
						$if(field("isStress"), render(field("stress")), render(field("dev"))),
					),
				),
				p({ class: "text-base-content/60" }, "Pick a story."),
			),
		),
	),
	on: {
		setFilterText: {
			args: [t.string()],
			run(next, [text]) {
				next.filterText = text;
				syncCollapsed(next);
			},
		},
		// A group opens or closes; with all, every group does as it does.
		groupToggled: {
			args: [t.string(), t.boolean()],
			run(next, [group, all], ctx) {
				ctx.stopNext();
				const { collapsed } = this;
				const opens = collapsed.includes(group);
				if (all) next.collapsed = opens ? [] : [...new Set(this.links.map((l) => l.group))];
				else next.collapsed = opens ? collapsed.filter((g) => g !== group) : [...collapsed, group];
				syncCollapsed(next);
			},
		},
		// Shows the new story from its top, wherever the list was scrolled to, and remembers it
		// (in the page's URL) to open it again on a reload.
		storySelected: {
			args: [t.string()],
			emits: { ask: ["scrollToTop", "rememberStory"] },
			run(next, [id], ctx) {
				selectStory(this, next, id);
				ctx.stopNext();
				ctx.ask("scrollToTop");
				ctx.ask("rememberStory", [id]);
			},
		},
		setPanel: {
			args: [t.enum("steps", "stress", "dev")],
			run(next, [panel]) {
				next.panel = panel;
			},
		},
		...panelHandlers("panel"),
		reroll(next) {
			next.seed = this.seed + 1;
			resetPanels(this, next);
		},
	},
	answers: {
		scrollToTop: {
			ok() {},
			error() {},
			unhandled() {},
		},
		rememberStory: {
			ok() {},
			error() {},
			unhandled() {},
		},
	},
});
// A filter shows every match, collapsed or not.
const syncCollapsed = (next) => {
	const filtering = next.filterText.trim() !== "";
	next.links.forEach((link, i) => {
		const isCollapsed = !filtering && next.collapsed.includes(link.group);
		next.links[i] = apply(link, "setCollapsed", isCollapsed);
	});
};
const selectStory = (self, next, id) => {
	const link = self.links.find((l) => l.id === id);
	if (link === undefined) return;
	next.selectedId = id;
	next.isGenerated = link.isGenerated;
	next.links.forEach((l, i) => {
		next.links[i] = apply(l, "setSelected", self.links[i].id === id);
	});
	resetPanels(self, next);
};
