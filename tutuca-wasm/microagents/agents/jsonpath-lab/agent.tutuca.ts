// jsonpath-lab: JSONPath expressions run against one JSON document. A path may say how many
// results it should give (expectedCount, -1 when it doesn't). The page shows each path's
// status, the document as a tree with the focused path's matches highlighted, and its results.
// The document is edited as JSON text, kept while it doesn't parse. The paths run in the page
// (microagents/jsonpath, microagents/engines/jsonpath.js, with jsonpath-plus). The root's
// messages are the agent's tools; the rows' inputs send messages of their own, by the row's key.
import type { MicroAgent } from "../../kit/kit.tutuca";
import {
	button,
	div,
	each,
	field,
	h,
	h2,
	h3,
	header,
	lookupBind,
	send,
	sourceKey,
	span,
	targetValue,
	textarea,
	when,
} from "tutuca/view";
import { parseJson, range, toJson } from "tutuca/data";
import { documentNodes, pathProblem, runPath } from "microagents/jsonpath";

/** A path, with the id the model names it by (p1, p2, …), its JSONPath, and how many results it
 * should give (-1: no expectation). */
export type PathRow = { id: string; path: string; expectedCount: number };
/** What a path selects: error is "" when it ran. */
export type Run = { error: string; count: number; results: { pointer: string; value: unknown }[] };
export type InfoRow = { id: string; status: string; label: string };
export type Counts = { pass: number; fail: number; none: number; invalid: number };

const MAX_RESULTS = 200;
const MAX_ROWS = 1500;
const CLIP_AT = 80;

/** text cut to at most n characters, with … when it was longer. */
function clip(text: string, n: number): string {
	return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
}

/** A pointer as the page shows it: (root) for "". */
function shownPointer(pointer: string): string {
	return pointer === "" ? "(root)" : pointer;
}

/** The first of prefix1, prefix2, … that no item's id is, from the count up. */
function nextId(ids: readonly string[], prefix: string): string {
	for (const n of range(ids.length + 1, 2 * ids.length + 2)) {
		const id = `${prefix}${n}`;
		if (!ids.includes(id)) return id;
	}
	return `${prefix}${2 * ids.length + 2}`;
}

/** Where an item at from goes when it's moved to to: the order of the indexes, kept within the
 * list. */
function movedOrder(length: number, from: number, to: number): number[] {
	const rest = range(0, length).filter((j) => j !== from);
	const at = Math.max(0, Math.min(to, rest.length));
	const out: number[] = [];
	for (const j of range(0, rest.length)) {
		if (j === at) out.push(from);
		out.push(rest[j] ?? 0);
	}
	if (at >= rest.length) out.push(from);
	return out;
}

/** What path selects in the document (at most MAX_RESULTS results). */
function runOf(document: unknown, docError: string, path: string): Run {
	if (docError !== "") {
		const none: { pointer: string; value: unknown }[] = [];
		return { error: `the document isn't usable: ${docError}`, count: 0, results: none };
	}
	return runPath(path, document, MAX_RESULTS);
}

/** A path's status: pass, fail, none or invalid. */
function statusOf(row: Readonly<PathRow>, run: Readonly<Run>): string {
	if (run.error !== "") return "invalid";
	if (row.expectedCount < 0) return "none";
	return run.count === row.expectedCount ? "pass" : "fail";
}

export type JsonPathLab = {
	/** The paths, each with an id the model names it by (p1, p2, …), its JSONPath, and how many
	 * results it should give (-1: no expectation). */
	paths: PathRow[];
	/** The JSON document the paths run against. */
	document: unknown;
	/** The document as the user edits it; "" until it's edited. */
	docText: string;
	/** Why docText isn't JSON; "" when it is (and document is its value). */
	docError: string;
	/** The path whose matches the tree highlights; "" for the first. */
	focus: string;
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	readonly headline: string;
	/** The document as JSON text, as the editor shows it. */
	readonly editorText: string;
	/** The paths as rows, with why each isn't a JSONPath ("" when it is). */
	readonly pathRows: { id: string; path: string; problem: string }[];
	/** Each path's status: pass, fail, none (no expected count) or invalid. */
	readonly infoRows: InfoRow[];
	readonly focusLabel: string;
	/** The focused path's results: each one's JSON Pointer and value. */
	readonly focusedResults: { pointer: string; value: string }[];
	/** The document's nodes, the focused path's matches lit. */
	readonly treeRows: { key: string; text: string; style: string; hit: boolean }[];
	/** The document's nodes as JSON Pointers with their types (at most 200), to learn its shape. */
	readonly documentPaths: unknown;
	/** The counts of the paths' statuses. */
	readonly counts: Counts;
	/** What the focused path selects (no results with no path). */
	readonly focusedRun: Run;
};

export const JsonPathLab = {
	implements: ["MicroAgent"],
	meta: {
		// The status badges' classes, which their loop's enrich computes.
		"https://tutuca.dev/meta/classes": { classes: "badge badge-success badge-error badge-warning badge-ghost" },
	},
	defaults: { document: null, docText: "", docError: "", focus: "" },
	constraints: { paths: { minLength: 1 } },
	queries: {
		get counts(): Counts {
			let pass = 0;
			let fail = 0;
			let none = 0;
			let invalid = 0;
			for (const row of this.paths) {
				const st = statusOf(row, runOf(this.document, this.docError, row.path));
				if (st === "pass") pass += 1;
				if (st === "fail") fail += 1;
				if (st === "none") none += 1;
				if (st === "invalid") invalid += 1;
			}
			return { pass, fail, none, invalid };
		},
		get headline(): string {
			const c = this.counts;
			return `${this.paths.length} paths · ${c.pass} pass · ${c.fail} fail · ${c.invalid} invalid`;
		},
		get summary(): string {
			const c = this.counts;
			const lines = [
				`${this.paths.length} paths: ${c.pass} pass, ${c.fail} fail, ${c.none} have no expected count, ${c.invalid} invalid.`,
				"paths:",
			];
			for (const row of this.paths) {
				const run = runOf(this.document, this.docError, row.path);
				const got = run.error !== "" ? `error: ${run.error}` : `${run.count} results`;
				const wanted = row.expectedCount >= 0 ? `, expected ${row.expectedCount} (${statusOf(row, run)})` : "";
				lines.push(`  ${row.id}: ${row.path} → ${got}${wanted}`);
			}
			lines.push(
				this.docError !== "" ? `document: not JSON: ${this.docError}` : `document: ${clip(toJson(this.document, 0), 400)}`,
			);
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { paths, document }. */
		get data(): unknown {
			return { paths: this.paths, document: this.document };
		},
		get domain(): unknown {
			return { paths: this.paths, document: this.document };
		},
		get editorText(): string {
			return this.docText !== "" ? this.docText : toJson(this.document, 2);
		},
		get pathRows() {
			return this.paths.map((row) => ({ id: row.id, path: row.path, problem: pathProblem(row.path) }));
		},
		get infoRows(): InfoRow[] {
			return this.paths.map((row) => {
				const run = runOf(this.document, this.docError, row.path);
				let label = run.error;
				if (run.error === "") {
					label = `${run.count} results`;
					if (row.expectedCount >= 0) label = `${label} (expected ${row.expectedCount})`;
				}
				return { id: row.id, status: statusOf(row, run), label };
			});
		},
		get focusLabel(): string {
			const at = this.paths.findIndex((row) => row.id === this.focus);
			const row = this.paths[at < 0 ? 0 : at];
			return row === undefined ? "no path" : row.path;
		},
		get focusedRun(): Run {
			const at = this.paths.findIndex((row) => row.id === this.focus);
			const row = this.paths[at < 0 ? 0 : at];
			if (row === undefined) {
				const none: { pointer: string; value: unknown }[] = [];
				return { error: "", count: 0, results: none };
			}
			return runOf(this.document, this.docError, row.path);
		},
		get focusedResults() {
			return this.focusedRun.results.map((r) => ({ pointer: shownPointer(r.pointer), value: clip(toJson(r.value, 0), CLIP_AT) }));
		},
		get treeRows() {
			const hits = this.focusedRun.results.map((r) => r.pointer);
			if (this.docError !== "") {
				const none: { key: string; text: string; style: string; hit: boolean }[] = [];
				return none;
			}
			return documentNodes(this.document, MAX_ROWS).map((n) => ({
				key: n.key,
				text: clip(n.text, CLIP_AT),
				style: `padding-left: ${n.depth * 1.25}rem`,
				hit: hits.includes(n.pointer),
			}));
		},
		get documentPaths(): unknown {
			if (this.docError !== "") return { error: this.docError };
			const nodes = documentNodes(this.document, MAX_ROWS);
			const sample = nodes.slice(0, MAX_RESULTS).map((n) => `${shownPointer(n.pointer)}: ${n.type}`);
			return { nodes: nodes.length, sample };
		},
		/** What a path selects: its count, its expected count if any, and each result's JSON
		 * Pointer and value (at most 200). */
		results(id: string): unknown {
			const row = this.paths.find((r) => r.id === id);
			if (row === undefined) return { error: `no path ${id}` };
			const run = runOf(this.document, this.docError, row.path);
			if (run.error !== "") return { error: run.error };
			if (row.expectedCount >= 0) return { path: row.path, count: run.count, expected: row.expectedCount, results: run.results };
			return { path: row.path, count: run.count, results: run.results };
		},
	},
	on: {
		/** Change a path's JSONPath expression. */
		setPath: {
			pure: true,
			changes: ["paths"],
			pre(prev, [id, path]: [string, string]) {
				return this.paths.some((r) => r.id === id);
			},
			run(next, [id, path]: [string, string]) {
				const i = this.paths.findIndex((r) => r.id === id);
				const old = this.paths[i];
				if (old !== undefined) next.paths[i] = { id, path, expectedCount: old.expectedCount };
			},
		},
		/** Add a JSONPath expression; it gets the next free id (p1, p2, …). */
		addPath: {
			pure: true,
			changes: ["paths"],
			post(prev, next, [path]: [string]) {
				return next.paths.length === prev.paths.length + 1;
			},
			run(next, [path]: [string]) {
				next.paths.push({ id: nextId(this.paths.map((r) => r.id), "p"), path, expectedCount: -1 });
			},
		},
		/** Remove a path. pre is only checked in dev mode: the last path stays. */
		removePath: {
			pure: true,
			changes: ["paths", "focus"],
			pre(prev, [id]: [string]) {
				return this.paths.some((r) => r.id === id) && this.paths.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.paths.length === prev.paths.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.paths.findIndex((r) => r.id === id);
				if (i < 0 || this.paths.length <= 1) return;
				next.paths.splice(i, 1);
				if (this.focus === id) next.focus = "";
			},
		},
		/** Move a path to a position (0 is first). */
		reorderPaths: {
			pure: true,
			changes: ["paths"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.paths.some((r) => r.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.paths.length === prev.paths.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.paths.findIndex((r) => r.id === id);
				if (i < 0) return;
				const order = movedOrder(this.paths.length, i, index);
				next.paths = order.map((j) => this.paths[j] ?? { id: "", path: "", expectedCount: -1 });
			},
		},
		/** Say how many results a path should give, or -1 for no expectation. */
		setExpectedCount: {
			pure: true,
			changes: ["paths"],
			constraints: { count: { int: true, min: -1 } },
			pre(prev, [id, count]: [string, number]) {
				return this.paths.some((r) => r.id === id);
			},
			run(next, [id, count]: [string, number]) {
				const i = this.paths.findIndex((r) => r.id === id);
				const old = this.paths[i];
				if (old !== undefined) next.paths[i] = { id, path: old.path, expectedCount: count };
			},
		},
		/** Replace the JSON document the paths run against. */
		setDocument: {
			pure: true,
			changes: ["document", "docText", "docError"],
			run(next, [document]: [unknown]) {
				next.document = document;
				next.docText = "";
				next.docError = "";
			},
		},
		/** The document's text, from its editor: kept while it isn't JSON. */
		setDocumentText: {
			pure: true,
			changes: ["document", "docText", "docError"],
			run(next, [text]: [string]) {
				const parsed = parseJson(text);
				next.docText = text;
				if (parsed === undefined) {
					next.docError = "the text isn't JSON";
					return;
				}
				next.document = parsed;
				next.docError = "";
			},
		},
		/** Which path the tree highlights. */
		focus: {
			pure: true,
			changes: ["focus"],
			post(prev, next, [id]: [string]) {
				return next.focus === id;
			},
			run(next, [id]: [string]) {
				next.focus = id;
			},
		},
		// The rows' own, by the row's key.
		focusAt: {
			pure: true,
			changes: ["focus"],
			constraints: { at: { keyOf: "paths" } },
			run(next, [at]: [number | null]) {
				const row = at === null ? undefined : this.paths[at];
				if (row !== undefined) next.focus = row.id;
			},
		},
		setPathAt: {
			pure: true,
			changes: ["paths"],
			constraints: { at: { keyOf: "paths" } },
			run(next, [at, path]: [number | null, string]) {
				const row = at === null ? undefined : this.paths[at];
				if (at !== null && row !== undefined) next.paths[at] = { id: row.id, path, expectedCount: row.expectedCount };
			},
		},
		removePathAt: {
			pure: true,
			changes: ["paths", "focus"],
			constraints: { at: { keyOf: "paths" } },
			run(next, [at]: [number | null]) {
				const row = at === null ? undefined : this.paths[at];
				if (at === null || row === undefined || this.paths.length <= 1) return;
				next.paths.splice(at, 1);
				if (this.focus === row.id) next.focus = "";
			},
		},
	},
	loops: {
		infoRows: {
			enrich(key: number, row: InfoRow) {
				const cls =
					row.status === "pass"
						? "badge badge-success"
						: row.status === "fail"
							? "badge badge-error"
							: row.status === "invalid"
								? "badge badge-warning"
								: "badge badge-ghost";
				return { badgeClass: cls };
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "JSONPath lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Paths"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("pathRows"),
				div(
					{ class: "flex flex-col gap-1" },
					div(
						{ class: "join w-full" },
						button(
							{
								class: "btn btn-sm join-item font-mono",
								title: "Highlight this path's matches",
								"on:click": send("focusAt", sourceKey()),
							},
							field("id"),
						),
						h("input", {
							class: "input input-sm input-bordered join-item flex-1 font-mono",
							"aria-label": "JSONPath",
							value: field("path"),
							"on:input": send("setPathAt", sourceKey(), targetValue()),
						}),
						button(
							{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removePathAt", sourceKey()) },
							"✕",
						),
					),
					when(field("problem"), h("p", { class: "text-xs text-error" }, field("problem"))),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addPath", "$") }, "+ Path"),
		),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("infoRows"),
				div(
					{ class: "flex items-center gap-2 text-sm" },
					span({ class: "font-mono text-xs opacity-70" }, field("id")),
					span({ class: lookupBind("badgeClass") }, field("status")),
					span({}, field("label")),
				),
				"infoRows",
			),
		),
		h3(
			{ class: "text-xs font-semibold uppercase tracking-wide opacity-60" },
			"Document, matches of ",
			span({ class: "font-mono normal-case" }, field("focusLabel")),
		),
		div(
			{ class: "rounded-box border border-base-300 p-2 font-mono text-sm max-h-96 overflow-auto" },
			each(
				field("treeRows"),
				div(
					{ style: field("style") },
					span(
						{ class: when(field("hit"), "flex gap-2 rounded bg-warning/40 outline outline-1 outline-warning", "flex gap-2") },
						span({ class: "opacity-60" }, field("key")),
						span({}, field("text")),
					),
				),
			),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Results"),
		div(
			{ class: "flex flex-col gap-0.5 rounded-box bg-base-200 p-2 font-mono text-xs max-h-60 overflow-auto" },
			each(
				field("focusedResults"),
				div({ class: "flex gap-2" }, span({ class: "opacity-60" }, field("pointer")), span({ class: "break-all" }, field("value"))),
			),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Document JSON"),
		textarea({
			class: "textarea textarea-bordered w-full font-mono text-xs",
			rows: "8",
			"aria-label": "Document JSON",
			value: field("editorText"),
			"on:input": send("setDocumentText", targetValue()),
		}),
		when(field("docError"), h("p", { class: "text-xs text-error" }, field("docError"))),
	),
};

export const register = { JsonPathLab: "JsonPathLab" };
