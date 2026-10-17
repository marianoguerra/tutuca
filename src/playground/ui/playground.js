// The playground's side of a run: pick an example and a story, see it live in a <tutuca-app>
// and look into it with the storybook's panels. The element runs the code and sends the
// stories of each run here; a new run gives the app a new key, so it mounts again.
import { makeDevPanel } from "../../dev/panel.js";
import { applyAppReport, resetPanels } from "../../storybook/ui/panels.js";
import { $if, component, each, field, render, send, t, tag, targetValue } from "../../tutuca.js";

const { button, div, option, p, pre, section, select, span } = tag;
const tutucaApp = tag["tutuca-app"];

export const TABS = ["preview", "steps", "stress", "dev"];
const TAB_LABELS = { preview: "Preview", steps: "Steps", stress: "Stress test", dev: "Dev" };
const tabGetter = (name) => `is${name[0].toUpperCase()}${name.slice(1)}`;

const tabButton = (name) =>
	button(
		{
			type: "button",
			role: "tab",
			class: $if(field(tabGetter(name)), "tab tab-active", "tab"),
			"@on.click": send("setTab", name),
		},
		TAB_LABELS[name],
		...(name === "dev"
			? [
					$if(
						field("hasIssues"),
						span({ class: "badge badge-sm badge-warning ml-1" }, field("issueCount")),
						"",
					),
				]
			: []),
	);

export const Playground = component({
	name: "Playground",
	fields: (t) => ({
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
	}),
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
		{ class: "flex h-full min-h-0 flex-col gap-3 bg-base-200 p-3 text-base-content" },
		div(
			{ class: "flex flex-wrap items-center gap-2" },
			$if(
				field("hasExamples"),
				select(
					{
						class: "select select-sm select-bordered",
						"aria-label": "Example",
						value: field("example"),
						"@on.change": send("selectExample", targetValue()),
					},
					each(field("examples"), option({ value: field("id") }, field("title"))),
				),
				"",
			),
			$if(
				field("hasStories"),
				select(
					{
						class: "select select-sm select-bordered min-w-0 max-w-full",
						"aria-label": "Story",
						value: field("selectedId"),
						"@on.change": send("selectStory", targetValue()),
					},
					each(field("stories"), option({ value: field("id") }, field("label"))),
				),
				"",
			),
			$if(field("isLoading"), span({ class: "loading loading-spinner loading-sm" }), ""),
			div({ role: "tablist", class: "tabs tabs-box tabs-sm ml-auto" }, ...TABS.map(tabButton)),
		),
		div(
			{ class: "min-h-0 flex-1 overflow-auto" },
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
								"@on.tutucareport": send("appReport"),
							}),
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
			run(draft, [stories, run, wanted]) {
				draft.stories = stories;
				draft.status = "ready";
				draft.error = "";
				draft.run = run;
				const keep = (id) => id !== "" && stories.some((s) => s.id === id);
				const id = keep(wanted)
					? wanted
					: keep(this.selectedId)
						? this.selectedId
						: (stories[0]?.id ?? "");
				showStory(this, draft, id);
			},
		},
		setExamples: {
			args: [t.array(t.record({ id: t.string(), title: t.string() }))],
			run(draft, [examples]) {
				draft.examples = examples;
			},
		},
		loading: {
			args: [t.string()],
			run(draft, [example]) {
				draft.example = example;
				draft.status = "loading";
			},
		},
		failed: {
			args: [t.string()],
			run(draft, [error]) {
				draft.status = "failed";
				draft.error = error;
			},
		},
		selectExample: {
			args: [t.string()],
			emits: { ask: ["playground"] },
			run(draft, [id], ctx) {
				draft.example = id;
				draft.status = "loading";
				ctx.ask("playground", ["example", id]);
			},
		},
		selectStory: {
			args: [t.string()],
			emits: { ask: ["playground"] },
			run(draft, [id], ctx) {
				showStory(this, draft, id);
				ctx.ask("playground", ["story", id]);
			},
		},
		playgroundReplyOk() {},
		playgroundReplyError(draft, [error]) {
			draft.status = "failed";
			draft.error = String(error?.message ?? error);
		},
		playgroundHandlerNotFound() {},
		setTab: {
			args: [t.enum(...TABS)],
			run(draft, [tab]) {
				draft.tab = tab;
			},
		},
		showSteps(draft, _args, ctx) {
			draft.tab = "steps";
			ctx.stopNext();
		},
		appReport(draft, _args, ctx) {
			const detail = ctx.event?.detail;
			if (detail?.key === this.appKey && detail.type === "state") {
				draft.issueCount = detail.data.dev?.issues.length ?? 0;
			}
			applyAppReport(this, draft, detail);
		},
	},
});

const showStory = (self, draft, id) => {
	draft.selectedId = id;
	draft.issueCount = 0;
	resetPanels(self, draft, `r${draft.run}/${id}@${self.seed}`);
};

export const makePlayground = (C) =>
	C.Playground({
		status: "loading",
		story: C.StoryPanel({}),
		stress: C.StressPanel({}),
		dev: makeDevPanel(C),
	});

// Lists, in each story's label, its book's title when there are many books.
export const storyChoices = (books) =>
	books.flatMap((book) =>
		book.stories.map((story) => ({
			id: story.id,
			label: books.length > 1 ? `${book.title} › ${story.name}` : story.name,
		})),
	);
