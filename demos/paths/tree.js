// The tour's path tree: tutuca components that show every step of the tree (src/dev/path-tree.js)
// as the text outline does (src/dev/path-tree-text.js), one row per step, and light the rows the
// page points at: the one hovered, the ones an event's walk went through, where each message
// landed and what a change copied.
import { expand, pathTree } from "../../src/dev/path-tree.js";
import { componentText, stepParts } from "../../src/dev/path-tree-text.js";
import { $if, component, each, field, renderEach, send, t, tag } from "../../src/tutuca.js";
import { pathKey, pathLabel } from "./regions.js";

const { div, span } = tag;

const MARKS = { active: "●", inactive: "○", last: "◆" };

// What a place counts (trail.js), in the order a row shows them, and what each one is.
export const KINDS = ["event", "walk", "passed", "handled", "other"];
export const KIND_TEXT = {
	event: "events here",
	walk: "events walked through",
	passed: "notifications passed through",
	handled: "handled here",
	other: "not delivered or failed",
};
export const NO_COUNTS = { event: 0, walk: 0, passed: 0, handled: 0, other: 0 };
const countsType = t.record({
	event: t.number(),
	walk: t.number(),
	passed: t.number(),
	handled: t.number(),
	other: t.number(),
});
const marksType = t.array(t.record({ name: t.string(), icon: t.string() }));
// The kinds a row shows a number for: other only when there's any.
const shownKinds = (counts) => KINDS.filter((kind) => kind !== "other" || counts.other > 0);

const TourStep = component({
	name: "TourStep",
	fields: {
		key: t.string(), // The step's path (regions.js's pathKey); "" for a loop, which has none.
		guide: t.string(), // The outline's lines to it: "│  ├─".
		mark: t.enum(["active", "inactive", "last"]),
		parts: t.array(t.record({ text: t.string(), tone: t.string() })),
		comp: t.string(),
		light: t.enum(["", "walk", "target", "hop"]),
		note: t.string(), // What happened there: "inc() handled".
		copied: t.boolean(),
		hover: t.boolean(),
		counts: countsType, // What went through it so far: "1/0/2/1" in the row.
		agents: marksType, // The agents here, each { name, icon }.
		bases: marksType, // The agents that started here and are elsewhere now.
		selected: t.boolean(), // The inspector shows it.
	},
	queries: {
		get markText() {
			return MARKS[this.mark];
		},
		get rowClass() {
			const names = ["pt-row", `pt-${this.mark}`];
			if (this.light !== "") names.push(`pt-light-${this.light}`);
			if (this.copied) names.push("pt-copied");
			if (this.hover) names.push("pt-hover");
			if (this.selected) names.push("pt-selected");
			return names.join(" ");
		},
		get agentMarks() {
			return this.agents.map(({ name, icon }) => ({ icon, title: `${name} is here` }));
		},
		get baseMarks() {
			return this.bases.map(({ name, icon }) => ({ icon, title: `${name} started here` }));
		},
		get hasCounts() {
			return KINDS.some((kind) => this.counts[kind] > 0);
		},
		// Each number in its kind's colour, a zero dimmed, with a / between them.
		get countParts() {
			return shownKinds(this.counts).flatMap((kind, i) => {
				const n = this.counts[kind];
				const part = {
					text: String(n),
					tone: `pt-count pt-count-${kind}${n === 0 ? " pt-zero" : ""}`,
				};
				return i === 0 ? [part] : [{ text: "/", tone: "pt-count-sep" }, part];
			});
		},
		get countsTitle() {
			return shownKinds(this.counts)
				.map((kind) => `${this.counts[kind]} ${KIND_TEXT[kind]}`)
				.join(" / ");
		},
		get hasComp() {
			return this.comp !== "";
		},
		get hasNote() {
			return this.note !== "";
		},
	},
	view: div(
		{ class: field("rowClass"), "data-step": field("key"), "on:click": send("pick") },
		span({ class: "pt-guide" }, field("guide")),
		span({ class: "pt-mark" }, field("markText")),
		span({ class: "pt-text" }, each(field("parts"), span({ class: field("tone") }, field("text")))),
		$if(field("hasComp"), span({ class: "pt-comp" }, field("comp")), ""),
		$if(field("hasNote"), span({ class: "pt-note" }, field("note")), ""),
		$if(
			field("selected"),
			span({ class: "pt-inspected", title: "The inspector shows this place" }, "🔍"),
			"",
		),
		each(
			field("baseMarks"),
			span({ class: "pt-base", title: field("title") }, "⚓", field("icon")),
		),
		each(field("agentMarks"), span({ class: "pt-agent", title: field("title") }, field("icon"))),
		$if(
			field("hasCounts"),
			span(
				{ class: "pt-counts", title: field("countsTitle") },
				each(field("countParts"), span({ class: field("tone") }, field("text"))),
			),
			"",
		),
	),
	on: {
		// A click on the row: whoever holds the tree shows the place in its inspector.
		pick: {
			emits: { notify: ["pick"] },
			run(_next, _args, ctx) {
				if (this.key !== "") ctx.notify("pick", [this.key]);
			},
		},
	},
});

const TourTree = component({
	name: "TourTree",
	fields: { rows: t.array(t.component("TourStep")) },
	view: div({ class: "pt-tree" }, renderEach(field("rows"))),
	on: {
		// Lights the rows at keys as kind, with note.
		light(next, [keys, kind, note = ""]) {
			for (const row of next.rows) {
				if (row.key === "" || !keys.includes(row.key)) continue;
				row.light = kind;
				row.note = note;
			}
		},
		copied(next, [keys]) {
			for (const row of next.rows) row.copied = row.key !== "" && keys.includes(row.key);
		},
		hover(next, [key]) {
			for (const row of next.rows) row.hover = key !== "" && row.key === key;
		},
		clear(next) {
			for (const row of next.rows) {
				row.light = "";
				row.note = "";
				row.copied = false;
			}
		},
	},
});

export const tourComponents = { TourStep, TourTree };

// The rows of root's path tree, every step walked, the ones on focus (a DispatchPath, null for
// none) marked: [{ row, instance, path, label, parent }], row what a TourStep is made of,
// instance the component the step renders (null when it renders none), path its path, label it
// in words and parent the key of the nearest row above it that has one ("" for the root).
export const rowsOf = (root, focus = null) => {
	const rows = [];
	const walk = (node, prefix, head, parent) => {
		const { t: kind } = node.step;
		const key = kind === "each" || kind === "more" ? "" : pathKey(node.path);
		rows.push({
			row: {
				key,
				guide: head,
				mark: node.last ? "last" : node.active ? "active" : "inactive",
				parts: stepParts(node.step).map(({ tone, text }) => ({ tone: `pt-${tone}`, text })),
				comp: componentText(node),
			},
			instance: node.instance,
			path: node.path,
			label: pathLabel(node.path),
			parent,
		});
		const children = expand(node);
		children.forEach((child, i) => {
			const isLast = i === children.length - 1;
			const below = `${prefix}${isLast ? "   " : "│  "}`;
			walk(child, below, `${prefix}${isLast ? "└─" : "├─"}`, key === "" ? parent : key);
		});
	};
	walk(pathTree(root, { path: focus, siblings: 12 }), "", "", "");
	return rows;
};
