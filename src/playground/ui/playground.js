// The playground's side of a run: pick an example and a story, see it live in a <tutuca-app>
// and look into it with the storybook's panels. The element runs the code and sends the
// stories of each run here; a new run gives the app a new key, so it mounts again.
import { makeDevPanel } from "../../dev/panel.js";
import { showArgs } from "../../history/bar.js";
import { tabButton } from "../../storybook/ui/common.js";
import { applyAppReport, resetPanels } from "../../storybook/ui/panels.js";
import {
	$if,
	component,
	each,
	field,
	render,
	scopeOf,
	send,
	t,
	tag,
	targetValue,
} from "../../tutuca.js";

const { div, option, p, pre, section, select, span } = tag;
const tutucaApp = tag["tutuca-app"];

const TABS = ["preview", "steps", "stress", "dev"];
const TAB_LABELS = { preview: "Preview", steps: "Steps", stress: "Stress test", dev: "Dev" };
// The dev tab counts the lint issues of the run.
const issueBadge = $if(
	field("hasIssues"),
	span({ class: "badge badge-sm badge-warning ml-1" }, field("issueCount")),
	"",
);
const playgroundTab = (name) =>
	tabButton("setTab", name, TAB_LABELS[name], ...(name === "dev" ? [issueBadge] : []));

export const Playground = component({
	name: "Playground",
	fields: {
		examples: t.array(t.record({ id: t.string(), title: t.string() })),
		example: t.string(),
		stories: t.array(t.record({ id: t.string(), label: t.string() })),
		selectedId: t.string(),
		seed: t.number().int().min(0),
		run: t.number().int().min(0),
		status: t.enum("loading", "ready", "failed"),
		error: t.string(),
		tab: t.enum(...TABS),
		issueCount: t.number().int().min(0),
		story: t.component("StoryPanel"),
		stress: t.component("StressPanel"),
		dev: t.component("DevPanel"),
		travel: t.component("TimeTravel"), // Under the preview, over the story's timeline.
	},
	methods: {
		get appKey() {
			return `r${this.run}/${this.selectedId}@${this.seed}`;
		},
		get isPreview() {
			return this.tab === "preview";
		},
		get isSteps() {
			return this.tab === "steps";
		},
		get isStress() {
			return this.tab === "stress";
		},
		get isDev() {
			return this.tab === "dev";
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
	},
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
							{
								class: $if(
									field("isPreview"),
									"card border border-base-300 bg-base-100 p-4 shadow-sm",
									"hidden",
								),
							},
							tutucaApp({
								class: "block",
								"app-key": field("appKey"),
								"on:tutucareport": send("appReport"),
							}),
							div({ class: "mt-3 empty:hidden" }, render(field("travel"))),
						),
						$if(field("isSteps"), render(field("story")), ""),
						$if(field("isStress"), render(field("stress")), ""),
						$if(field("isDev"), render(field("dev")), ""),
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
		setTab: {
			args: [t.enum(...TABS)],
			run(next, [tab]) {
				next.tab = tab;
			},
		},
		showSteps(next, _args, ctx) {
			next.tab = "steps";
			ctx.stopNext();
		},
		appReport(next, _args, ctx) {
			const detail = ctx.event?.detail;
			if (detail?.key === this.appKey && detail.type === "state") {
				const { dev, timeline, cursor } = detail.data;
				next.issueCount = dev?.issues.length ?? 0;
				const [size, , label, origin] = showArgs({
					size: timeline.length,
					current: timeline[cursor],
				});
				Object.assign(next.travel, { target: this.appKey, size, cursor, label, origin });
			}
			applyAppReport(this, next, detail);
		},
	},
	answers: {
		playground: {
			ok() {},
			error(next, [error]) {
				next.status = "failed";
				next.error = String(error?.message ?? error);
			},
			unhandled() {},
		},
	},
});

const showStory = (self, next, id) => {
	next.selectedId = id;
	next.issueCount = 0;
	resetPanels(self, next, `r${next.run}/${id}@${self.seed}`);
	next.travel = scopeOf(self).components.TimeTravel();
};

export const makePlayground = (C) =>
	C.Playground({
		status: "loading",
		story: C.StoryPanel({}),
		stress: C.StressPanel({}),
		dev: makeDevPanel(C),
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
