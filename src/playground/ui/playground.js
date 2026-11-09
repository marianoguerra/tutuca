// The playground's side of a run: pick an example and a story, see it live in a <tutuca-app>
// and look into it with the story panels (src/panels). The element runs the code and sends the
// stories of each run here; a new run gives the app a new key, so it mounts again.
import { showArgs } from "../../history/bar.js";
import { appCard, tabButton } from "../../panels/ui/common.js";
import {
	makePanels,
	PANEL_LABELS,
	PANELS,
	panelFields,
	panelHandlers,
	panelsView,
	resetPanels,
	storyApp,
	withPanelQueries,
} from "../../panels/ui/panels.js";
import { storyAppKey } from "../../stories/key.js";
import {
	$if,
	apply,
	component,
	each,
	errorMessage,
	field,
	render,
	scopeOf,
	send,
	t,
	tag,
	targetValue,
} from "../../tutuca.js";

const { div, option, p, pre, section, select, span } = tag;

// What it shows: the app, or one of its panels with the app kept mounted.
const TABS = ["preview", ...PANELS];
const TAB_LABELS = { preview: "Preview", ...PANEL_LABELS };
// The dev tab counts the lint issues of the run.
const issueBadge = $if(
	field("hasIssues"),
	span({ class: "badge badge-sm badge-warning ml-1" }, field("issueCount")),
	"",
);
const playgroundTab = (name) =>
	tabButton("setPanel", name, TAB_LABELS[name], ...(name === "dev" ? [issueBadge] : []));

export const Playground = component({
	name: "Playground",
	fields: {
		examples: t.array(t.record({ id: t.string(), title: t.string() })),
		example: t.string(),
		stories: t.array(t.record({ id: t.string(), label: t.string() })),
		selectedId: t.string(),
		run: t.number().int().min(0),
		status: t.enum("loading", "ready", "failed"),
		error: t.string(),
		panel: t.enum(...TABS),
		issueCount: t.number().int().min(0),
		...panelFields,
		travel: t.component("TimeTravel"), // Under the preview, over the story's timeline.
	},
	queries: withPanelQueries({
		get appKey() {
			return storyAppKey(`r${this.run}/`, this.selectedId);
		},
		get isPreview() {
			return this.panel === "preview";
		},
		get hasExamples() {
			return this.examples.length > 1;
		},
		get hasStories() {
			return this.stories.length > 1;
		},
		get isLoading() {
			return this.status === "loading";
		},
		get isFailed() {
			return this.status === "failed";
		},
		get isShowing() {
			return this.status === "ready" && this.selectedId !== "";
		},
		get hasIssues() {
			return this.issueCount > 0;
		},
	}),
	view: div(
		{ class: "flex h-full min-h-0 flex-col bg-base-200 text-base-content" },
		// One strip, like the editor's file tabs: the panels on the left, the pickers fill the rest.
		div(
			{
				class:
					"flex min-w-0 flex-wrap items-center gap-2 border-b border-base-300 bg-base-200 px-2 py-1",
			},
			div(
				{ role: "tablist", class: "tabs tabs-border tabs-sm shrink-0" },
				...TABS.map(playgroundTab),
			),
			div(
				{ class: "ml-auto flex min-w-0 flex-1 items-center justify-end gap-2" },
				$if(field("isLoading"), span({ class: "loading loading-spinner loading-sm" }), ""),
				$if(
					field("hasExamples"),
					select(
						{
							class: "select select-sm select-bordered w-auto min-w-0 max-w-xs",
							"aria-label": "Example",
							value: field("example"),
							"on:change": send("selectExample", targetValue()),
						},
						each(field("examples"), option({ value: field("id") }, field("title"))),
					),
					"",
				),
				$if(
					field("hasStories"),
					select(
						{
							class: "select select-sm select-bordered w-auto min-w-0 max-w-xs flex-1",
							"aria-label": "Story",
							value: field("selectedId"),
							"on:change": send("selectStory", targetValue()),
						},
						each(field("stories"), option({ value: field("id") }, field("label"))),
					),
					"",
				),
			),
		),
		div(
			{ class: "min-h-0 flex-1 overflow-auto p-3" },
			$if(
				field("isFailed"),
				div(
					{ class: "alert alert-error items-start", role: "alert" },
					pre({ class: "whitespace-pre-wrap break-words font-mono text-xs" }, field("error")),
				),
				$if(
					field("isShowing"),
					div(
						{ class: "flex flex-col gap-3" },
						// The app stays mounted while other tabs show, so its state is kept.
						section(
							{ class: $if(field("isPreview"), appCard, "hidden") },
							storyApp(),
							div({ class: "mt-3 empty:hidden" }, render(field("travel"))),
						),
						panelsView(),
					),
					$if(field("isLoading"), "", p({ class: "text-base-content/60" }, "Nothing to show.")),
				),
			),
		),
	),
	on: {
		// From the element: the stories of a new run, keeping the selected story when it is
		// still there.
		loaded: {
			args: [
				t.array(t.record({ id: t.string(), label: t.string() })),
				t.number().int().min(0),
				t.string(),
			],
			run(next, [stories, run, wanted]) {
				next.stories = stories;
				next.status = "ready";
				next.error = "";
				next.run = run;
				const keep = (id) => id !== "" && stories.some((s) => s.id === id);
				const id = keep(wanted)
					? wanted
					: keep(this.selectedId)
						? this.selectedId
						: (stories[0]?.id ?? "");
				showStory(this, next, id);
			},
		},
		setExamples: {
			args: [t.array(t.record({ id: t.string(), title: t.string() }))],
			run(next, [examples]) {
				next.examples = examples;
			},
		},
		loading: {
			args: [t.string()],
			run(next, [example]) {
				next.example = example;
				next.status = "loading";
			},
		},
		failed: {
			args: [t.string()],
			run(next, [error]) {
				next.status = "failed";
				next.error = error;
			},
		},
		selectExample: {
			args: [t.string()],
			emits: { ask: ["playground"] },
			run(next, [id], ctx) {
				next.example = id;
				next.status = "loading";
				ctx.ask("playground", ["example", id]);
			},
		},
		selectStory: {
			args: [t.string()],
			emits: { ask: ["playground"] },
			run(next, [id], ctx) {
				showStory(this, next, id);
				ctx.ask("playground", ["story", id]);
			},
		},
		setPanel: {
			args: [t.enum(...TABS)],
			run(next, [panel]) {
				next.panel = panel;
			},
		},
		// Of the app's state reports, the run's lint issues and timeline too.
		...panelHandlers((_self, next, { dev, timeline, cursor }) => {
			next.issueCount = dev?.issues.length ?? 0;
			const shown = showArgs({ size: timeline.length, cursor, current: timeline[cursor] });
			next.travel = apply(next.travel, "show", ...shown);
		}),
	},
	answers: {
		playground: {
			ok() {},
			error(next, [error]) {
				next.status = "failed";
				next.error = errorMessage(error);
			},
			unhandled() {},
		},
	},
});

const showStory = (self, next, id) => {
	next.selectedId = id;
	next.issueCount = 0;
	resetPanels(self, next);
	next.travel = scopeOf(self).components.TimeTravel({ target: next.appKey });
};

export const makePlayground = (C) =>
	C.Playground({
		status: "loading",
		...makePanels(C),
		travel: C.TimeTravel(),
	});

// Lists, in each story's label, its book's title when there are many books.
export const storyChoices = (books) =>
	books.flatMap((book) =>
		book.stories.map((story) => ({
			id: story.id,
			label: books.length > 1 ? `${book.title} › ${story.name}` : story.name,
		})),
	);
