import { SYNC_MODES } from "./sync/engines.js";

// The demos, in the order the demo index and the site's landing page list them. dir is the
// demo's folder here and the component folders its source is in; story opens in the storybook.
export const demos = [
	{
		dir: "todo",
		emoji: "✅",
		title: "Todo",
		blurb: "Projects, labels, priorities, subtasks and quick add that reads “tomorrow p1 #Work”.",
		story: "Todo/App/Today",
		sources: ["todo"],
	},
	{
		dir: "thing-tracker",
		emoji: "📈",
		title: "Thing tracker",
		blurb: "Log habits, moods and drinks with a tap; see insights by day, week or month.",
		story: "Thing tracker/App/Track",
		sources: ["thing-tracker"],
	},
	{
		dir: "json-schema",
		emoji: "📝",
		title: "Payload → Schema",
		blurb: "Edit an example API payload and get a documented JSON Schema for it.",
		story: "JSON Schema studio/Order payload",
		sources: ["json-schema", "json"],
	},
	{
		dir: "drawing",
		emoji: "🎨",
		title: "Sketchpad",
		blurb: "Draw rectangles, ellipses, lines and polylines; move, layer, undo and save as SVG.",
		story: "Drawing/Drawing/House",
		sources: ["drawing"],
	},
	{
		dir: "kanban",
		emoji: "🗂️",
		title: "Kanban",
		blurb: "Drag cards within a column or across columns; add and remove them as you go.",
		story: "Kanban/Board/Week",
		sources: ["kanban"],
	},
	{
		dir: "math",
		emoji: "➗",
		title: "Algebra workbench",
		blurb: "Solve quadratics with their plot, invert 2×2 matrices and keep the problems you saved.",
		story: "Math workbench/Two saved problems",
		sources: ["math"],
	},
	{
		dir: "composition",
		emoji: "📓",
		title: "Notebook",
		blurb:
			"A notebook of the other demos' components: add notes, todos, boards, drawings, trackers and notebooks as cells, drag them around, collapse them.",
		story: "Composition/Notebook/New",
		sources: ["composition"],
	},
	{
		dir: "lang",
		emoji: "🌳",
		title: "AST notations",
		blurb:
			"A small language's syntax tree as components: read or edit it as Lisp, Python, JavaScript or Forth, and see what it evaluates to.",
		story: "Lang/Editor/Lisp",
		sources: ["lang"],
	},
	{
		dir: "tree-spec",
		emoji: "🧭",
		title: "Tree spec explorer",
		blurb:
			"Step through the PLT Redex model of a component tree: pick which event or response comes next and watch where each message's address leads.",
		story: "Tree spec/Explorer/Ping and reply",
		sources: ["tree-spec"],
	},
	{
		dir: "notes",
		emoji: "🔀",
		title: "Notes",
		blurb:
			"A notes list for trying sync: the title and notes are shared, the filter stays on this device, the new note's text isn't kept.",
		story: null,
		sources: [],
	},
];

const escapeHtml = (s) =>
	s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SOURCE = "https://github.com/marianoguerra/tutuca/tree/main/components/";
const DEMO_SOURCE = "https://github.com/marianoguerra/tutuca/tree/main/demos/";
const storyHref = (story) =>
	`./storybook.html#${story.split("/").map(encodeURIComponent).join("/")}`;
// Links to a demo with each sync engine (see sync/engines.js), from its folder's parent.
const syncLinks = (href) =>
	Object.entries(SYNC_MODES)
		.map(([mode, label]) => `<a href="${href}?sync=${mode}">${label}</a>`)
		.join(' <span aria-hidden="true">·</span> ');

// The demo list of the site's landing page, from its root.
export const siteList = () =>
	demos
		.map(({ dir, emoji, title, blurb, story, sources }) => {
			const links =
				sources.length === 0
					? `<a href="${DEMO_SOURCE}${dir}">demos/${escapeHtml(dir)}</a>`
					: sources.map((s) => `<a href="${SOURCE}${s}">${escapeHtml(s)}</a>`).join(" ");
			const storybook =
				story === null
					? ""
					: `<a href="${storyHref(story)}">Storybook</a> <span aria-hidden="true">·</span> `;
			return `<li>
	<a class="demo-title" href="./demos/${dir}/"><span aria-hidden="true">${emoji}</span> ${escapeHtml(title)} <span class="arrow">↗</span></a>
	<p>${escapeHtml(blurb)}</p>
	<p class="demo-links">${storybook}Source: ${links}</p>
	<p class="demo-links">Sync: ${syncLinks(`./demos/${dir}/`)}</p>
</li>`;
		})
		.join("\n");

// The demo index, from the demos folder.
export const indexList = () =>
	demos
		.map(
			({ dir, title, blurb }) =>
				`<div class="demo-card"><a href="./${dir}/"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(blurb)}</p></a><p class="demo-sync">Sync: ${syncLinks(`./${dir}/`)}</p></div>`,
		)
		.join("\n");
