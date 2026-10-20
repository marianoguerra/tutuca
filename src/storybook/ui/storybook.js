// The storybook root: the sidebar of stories and the panels of the selected one.

import {
	$if,
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
import { applyAppReport, resetPanels } from "./panels.js";

const { aside, div, h1, h2, input, main, p, section, span, ul } = tag;
const tutucaApp = tag["tutuca-app"];

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
		story: t.component("StoryPanel"),
		stress: t.component("StressPanel"),
		dev: t.component("DevPanel"),
	},
	methods: {
		get appKey() {
			return `${this.selectedId}@${this.seed}`;
		},
		get hasStory() {
			return this.selectedId !== "";
		},
		get isSteps() {
			return this.panel === "steps";
		},
		get isStress() {
			return this.panel === "stress";
		},
		get isDev() {
			return this.panel === "dev";
		},
	},
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
				"@on.input": send("setFilterText", targetValue()),
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
								smallButton({ "@on.click": send("reroll") }, "Reroll"),
							),
							"",
						),
					),
					section(
						{ class: "card border border-base-300 bg-base-100 p-4 shadow-sm" },
						tutucaApp({
							class: "block",
							"app-key": field("appKey"),
							"@on.tutucareport": send("appReport"),
						}),
					),
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
			run(draft, [text]) {
				draft.filterText = text;
				syncCollapsed(draft);
			},
		},
		groupToggled: {
			args: [t.string()],
			run(draft, [group], ctx) {
				ctx.stopNext();
				const { collapsed } = this;
				draft.collapsed = collapsed.includes(group)
					? collapsed.filter((g) => g !== group)
					: [...collapsed, group];
				syncCollapsed(draft);
			},
		},
		// Shows the new story from its top, wherever the list was scrolled to.
		storySelected: {
			args: [t.string()],
			emits: { ask: ["scrollToTop"] },
			run(draft, [id], ctx) {
				selectStory(this, draft, id);
				ctx.stopNext();
				ctx.ask("scrollToTop");
			},
		},
		scrollToTopReplyOk() {},
		scrollToTopReplyError() {},
		scrollToTopHandlerNotFound() {},
		setPanel: {
			args: [t.enum("steps", "stress", "dev")],
			run(draft, [panel]) {
				draft.panel = panel;
			},
		},
		showSteps(draft, _args, ctx) {
			draft.panel = "steps";
			ctx.stopNext();
		},
		reroll(draft) {
			draft.seed = this.seed + 1;
			resetPanels(this, draft, `${this.selectedId}@${this.seed + 1}`);
		},
		// Reports from the story's <tutuca-app>; only events carry them.
		appReport(draft, _args, ctx) {
			applyAppReport(this, draft, ctx.event?.detail);
		},
	},
});
// A filter shows every match, collapsed or not.
const syncCollapsed = (draft) => {
	const filtering = draft.filterText.trim() !== "";
	for (const link of draft.links)
		link.isCollapsed = !filtering && draft.collapsed.includes(link.group);
};
export const selectStory = (self, draft, id) => {
	const link = self.links.find((l) => l.id === id);
	if (link === undefined) return;
	draft.selectedId = id;
	draft.isGenerated = link.isGenerated;
	draft.links.forEach((l, i) => {
		l.isSelected = self.links[i].id === id;
	});
	resetPanels(self, draft, `${id}@${self.seed}`);
};
