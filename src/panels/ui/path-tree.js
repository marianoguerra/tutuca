// Tutuca components that show the path tree (src/dev/path-tree.js): the steps a render takes
// from the root, the ones on the focus path active and open, the ones they don't take dimmed.
// A dimmed step opens to list its own steps; focusing a step makes its path the focus. Steps
// read as the text outline does (src/dev/path-tree-text.js), in the JSON tree's monospace.

import { expand, pathTree } from "../../dev/path-tree.js";
import { componentText, stepParts } from "../../dev/path-tree-text.js";
import { CLASSES_META } from "../../meta/classes.js";
import {
	$if,
	button,
	component,
	each,
	field,
	lookupBind,
	render,
	renderEach,
	scopeOf,
	send,
	t,
	tag,
} from "../../tutuca.js";
import { deref, refIdOf } from "./dev-panel.js";

const { div, span } = tag;

// The walked trees stay out of the state, as dev-panel's values do, which refers to their
// steps by dev-panel's refs. A walk is kept, by root, for each focus and siblings it was made
// with, so walking again finds the same steps: a message run twice makes the same state.
const trees = new WeakMap(); // root -> Map(key -> tree)
const frameKey = ({ provider, keys, item }) => [provider, keys, item];
const treeOf = (root, path, siblings) => {
	if (!trees.has(root)) trees.set(root, new Map());
	const byKey = trees.get(root);
	const key = JSON.stringify([siblings, path?.frames.map(frameKey) ?? null]);
	if (!byKey.has(key)) byKey.set(key, pathTree(root, { path, siblings }));
	return byKey.get(key);
};

const TONES = {
	punct: "opacity-50",
	name: "text-secondary",
	value: "text-success",
	kw: "text-accent",
	muted: "opacity-60",
};
const MARKS = { active: "●", inactive: "○", last: "◆" };

// A PathStep for step, its rows the steps below it that are walked.
const stepNode = (C, step) => {
	const walked = step.children ?? [];
	return C.PathStep({
		ref: refIdOf(step),
		parts: stepParts(step.step),
		comp: componentText(step),
		mark: step.last ? "last" : step.active ? "active" : "inactive",
		canFocus: step.step.t !== "more" && step.step.t !== "each",
		canOpen: walked.length > 0 || (step.children === null && step.hasChildren),
		isOpen: walked.length > 0,
		rows: walked.map((c) => stepNode(C, c)),
	});
};

const expander = $if(
	field("canOpen"),
	button(
		{
			type: "button",
			class: "w-3 shrink-0 cursor-pointer opacity-60 hover:opacity-100",
			"aria-label": "Expand",
			"on:click": send("toggle"),
		},
		$if(field("isOpen"), "▾", "▸"),
	),
	span({ class: "w-3 shrink-0" }),
);

export const PathStep = component({
	name: "PathStep",
	meta: { [CLASSES_META]: { classes: Object.values(TONES).join(" ") } },
	fields: {
		ref: t.number().int().min(0),
		parts: t.array(t.record({ text: t.string(), tone: t.enum(...Object.keys(TONES)) })),
		comp: t.string(),
		mark: t.enum("active", "inactive", "last"),
		canFocus: t.boolean(),
		canOpen: t.boolean(),
		isOpen: t.boolean(),
		rows: t.array(t.component("PathStep")),
	},
	queries: {
		get markText() {
			return MARKS[this.mark];
		},
		get lineClass() {
			const base = "group flex items-baseline gap-1";
			return this.mark === "inactive" ? `${base} opacity-50` : base;
		},
		get markClass() {
			return this.mark === "inactive" ? "opacity-60" : "text-primary";
		},
		get hasComp() {
			return this.comp !== "";
		},
		get showRows() {
			return this.isOpen && this.rows.length > 0;
		},
	},
	loops: {
		parts: {
			enrich({ value }) {
				return { tone: TONES[value.tone] };
			},
		},
	},
	view: div(
		{ class: "font-mono text-sm leading-6" },
		div(
			{ class: field("lineClass") },
			expander,
			span({ class: field("markClass") }, field("markText")),
			span(
				{ class: "min-w-0 break-all" },
				each(field("parts"), span({ class: lookupBind("tone") }, field("text")), "parts"),
			),
			$if(field("hasComp"), span({ class: "font-bold text-warning" }, field("comp")), ""),
			$if(
				field("canFocus"),
				button(
					{
						type: "button",
						class: "btn btn-ghost btn-xs invisible group-hover:visible",
						"on:click": send("focus"),
					},
					"focus",
				),
				"",
			),
		),
		$if(
			field("showRows"),
			div({ class: "ml-1.5 border-l border-base-300 pl-3" }, renderEach(field("rows"))),
			"",
		),
	),
	on: {
		toggle: {
			args: [],
			post: (prev, next) => next.isOpen !== prev.isOpen,
			run(next, _args, ctx) {
				next.isOpen = !this.isOpen;
				if (!next.isOpen || this.rows.length > 0) return;
				const step = deref(this.ref);
				if (step === undefined) return;
				const C = ctx.scope.components;
				next.rows = expand(step).map((c) => stepNode(C, c));
			},
		},
		// The tree takes it: notify bubbles up through the steps above this one.
		focus: {
			args: [],
			run(_next, _args, ctx) {
				ctx.notify("focusStep", [this.ref]);
			},
		},
	},
});

// The path tree of the component at rootRef (dev-panel's refs, 0 for none yet), focused on
// focusText's path ("" for none). In a story's panels it follows the app: showApp walks each
// state it shows, focused on the path of the last message, unless that's what it shows already.
export const PathTree = component({
	name: "PathTree",
	fields: {
		rootRef: t.number().int().min(0),
		siblings: t.number().int().min(0),
		focusText: t.string(),
		lastText: t.string(), // The focus showApp picked last.
		error: t.string(), // What walking the tree threw.
		tree: t.component("PathStep"),
	},
	queries: {
		get hasFocus() {
			return this.focusText !== "";
		},
		get hasRoot() {
			return this.rootRef !== 0;
		},
		get hasError() {
			return this.error !== "";
		},
	},
	view: div(
		{ class: "flex flex-col gap-2" },
		div(
			{ class: "flex items-baseline gap-2 text-xs" },
			span({ class: "opacity-60" }, "focus"),
			$if(
				field("hasFocus"),
				// One element: $if takes a node per branch (an array would render as a constant).
				span(
					{ class: "flex items-baseline gap-2" },
					span({ class: "font-mono" }, field("focusText")),
					button(
						{ type: "button", class: "btn btn-ghost btn-xs", "on:click": send("clearFocus") },
						"clear",
					),
				),
				span({ class: "font-mono opacity-60" }, "none: the whole tree"),
			),
		),
		$if(
			field("hasError"),
			tag.p({ class: "text-xs text-error" }, field("error")),
			$if(
				field("hasRoot"),
				render(field("tree")),
				tag.p({ class: "text-xs opacity-60" }, "No app yet."),
			),
		),
	),
	on: {
		focusStep: {
			args: [t.number().int().min(0)],
			run(next, [ref], ctx) {
				const step = deref(ref);
				if (step === undefined) return;
				ctx.stopNext();
				rebuild(next, ctx.scope.components, step.path);
			},
		},
		clearFocus: {
			args: [],
			run(next, _args, ctx) {
				rebuild(next, ctx.scope.components, null);
			},
		},
		// data: { state, transitions: [{ value: Transition }] }, a running app's (as DevPanel's
		// showApp gets it).
		showApp: {
			pure: true,
			run(next, [{ state, transitions }]) {
				const path = lastPath(transitions);
				const lastText = path === null ? "" : String(path);
				if (refIdOf(state) === this.rootRef && lastText === this.lastText) return;
				next.rootRef = refIdOf(state);
				next.lastText = lastText;
				rebuild(next, scopeOf(this).components, path);
			},
		},
	},
});
// Where the last message that went below the root went (a notify bubbling up to the root
// says less than the send that started it); null when none did.
const lastPath = (transitions = []) => {
	for (let i = transitions.length - 1; i >= 0; i--) {
		const path = transitions[i].value?.to?.path;
		if (path != null && !path.isRootPath) return path;
	}
	return null;
};
// Walks the tree again from the root, focused on path, into next.
const rebuild = (next, C, path) => {
	const root = deref(next.rootRef);
	if (root === undefined) return;
	next.focusText = path === null || path.isRootPath ? "" : String(path);
	try {
		next.tree = stepNode(C, treeOf(root, path, next.siblings));
		next.error = "";
	} catch (err) {
		next.error = `Can't walk the tree: ${err?.message ?? err}`;
	}
};

// A PathTree for root (none yet when null, as a story's panel starts), focused on path (a
// DispatchPath, or null for the whole tree).
export const makePathTree = (C, root = null, { path = null, siblings = 8 } = {}) => {
	if (root === null) return C.PathTree({ siblings });
	const next = { siblings, rootRef: refIdOf(root), focusText: "", error: "" };
	rebuild(next, C, path);
	return C.PathTree(next);
};

export const pathTreeComponents = { PathStep, PathTree };
