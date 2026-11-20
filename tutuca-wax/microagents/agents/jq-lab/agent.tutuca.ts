// jq-lab: jq filters run against JSON inputs. The grid shows each filter's outputs on each
// input, and an expectation ({ filter, input, outputs }) pins what a filter should give for an
// input, so the grid says pass or fail. jq runs in the page (microagents/jq,
// microagents/engines/jq.js, jq-wasm). The root's messages are the agent's tools; the rows'
// inputs send messages of their own, by the row's key.
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
	pre,
	send,
	sourceKey,
	span,
	targetValue,
	textarea,
	when,
} from "tutuca/view";
import { range, toJson, without } from "tutuca/data";
import { compileError, parseText, runFilter, sameJson, shapeOf, valueAt } from "microagents/jq";

/** A jq filter, with the id the model names it by (f1, f2, …). */
export type Filter = { id: string; filter: string };
/** A JSON input, with its id (i1, i2, …). */
export type Input = { id: string; value: unknown };
/** What a filter should output for an input, every output in order. */
export type Expectation = { filter: string; input: string; outputs: unknown[] };
/** An input's text as the user edits it, and why it isn't JSON ("" when it is). */
export type Draft = { text: string; error: string };
/** One cell: status is pass or fail when an expectation is pinned, else none, error (jq failed)
 * or invalid (the filter or the input doesn't parse). */
export type Cell = { status: string; outputs: unknown[] | null; error: string; more: boolean; expected: unknown[] | null };
export type OutputCell = {
	input: string;
	status: string;
	outputs: unknown[] | null;
	error: string;
	more: boolean;
	expected: unknown[] | null;
};
export type GridCell = { label: string; title: string; status: string };
export type Shown = { label: string; text: string; status: string };
export type Counts = { pass: number; fail: number; none: number; bad: number };

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

/** text, cut at n characters. */
function clip(text: string, n: number): string {
	return text.length <= n ? text : `${text.slice(0, n)}…`;
}

/** The first line of text. */
function firstLine(text: string): string {
	const at = text.indexOf("\n");
	return at < 0 ? text : text.slice(0, at);
}

/** Every output as JSON, one per line. */
function show(outputs: readonly unknown[]): string {
	return outputs.map((o) => toJson(o, 0)).join("\n");
}

/** Why the input with id's draft isn't JSON; "" when it is or there's none. */
function draftError(drafts: Readonly<{ [key: string]: Draft }>, id: string): string {
	const d = drafts[id];
	return d === undefined ? "" : d.error;
}

/** The index of the expectation of filter for input; -1 when there's none. */
function expectedIndex(expected: Readonly<Expectation[]>, filter: string, input: string): number {
	return expected.findIndex((e) => e.filter === filter && e.input === input);
}

/** The cell of filter on input. */
function cellOf(
	drafts: Readonly<{ [key: string]: Draft }>,
	expected: Readonly<Expectation[]>,
	filter: Readonly<Filter>,
	input: Readonly<Input>,
): Cell {
	const why = draftError(drafts, input.id);
	const inputBad = why !== "";
	const r = inputBad
		? { outputs: null, error: `the input isn't JSON: ${why}`, more: false }
		: runFilter(filter.filter, input.value, 100);
	const ei = expectedIndex(expected, filter.id, input.id);
	const pin = expected[ei];
	const wanted = ei >= 0 && pin !== undefined ? pin.outputs : null;
	let status = "none";
	if (r.outputs === null && wanted !== null) status = "fail";
	else if (inputBad || compileError(filter.filter) !== "") status = "invalid";
	else if (r.outputs === null) status = "error";
	else if (wanted !== null) status = sameJson(r.outputs, wanted) ? "pass" : "fail";
	return { status, outputs: r.outputs, error: r.error, more: r.more, expected: wanted };
}

/** A cell's outputs as text, or its error. */
function cellText(cell: Readonly<Cell>): string {
	const outputs = cell.outputs;
	if (outputs === null) return cell.error;
	const shown = outputs.length === 0 ? "(no output)" : show(outputs);
	return cell.more ? `${shown}\n…` : shown;
}

const CELL = "p-2 whitespace-pre-wrap break-all text-left font-mono text-xs";

export type JqLab = {
	/** The jq filters, each with an id the model names it by (f1, f2, …). */
	filters: Filter[];
	/** The JSON inputs, each with an id (i1, i2, …) and its value. */
	inputs: Input[];
	/** The pinned outputs: what a filter should output for an input, every output in order. */
	expected: Expectation[];
	/** The inputs' text as the user edits it, by input id, and why it isn't JSON ("" when it is). */
	drafts: { [key: string]: Draft };
	/** The filter whose outputs the outputs section shows; "" for the first. */
	focus: string;
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	readonly headline: string;
	readonly focusLabel: string;
	/** The filters as rows, with why each doesn't compile ("" when it does). */
	readonly filterRows: { id: string; filter: string; error: string }[];
	/** The inputs as rows: the text the editor shows and why it isn't JSON ("" when it is). */
	readonly inputRows: { id: string; text: string; error: string }[];
	/** Every filter × input: the outputs or the error, the expected outputs and whether they pass. */
	readonly outputs: { filter: string; cells: OutputCell[] }[];
	/** The grid laid out as one list for a CSS grid: a header row of input ids, then per filter
	 * its id and a cell per input. */
	readonly gridCells: GridCell[];
	readonly gridStyle: string;
	/** The focused filter's outputs on each input, and the expected outputs where some are pinned. */
	readonly shown: Shown[];
	/** The counts of the grid's statuses: pass, fail, unset and errors (jq failed or invalid). */
	readonly counts: Counts;
};

export const JqLab = {
	implements: ["MicroAgent"],
	meta: {
		// The grid cells' and the shown outputs' classes, which their loops' enrich computes.
		"https://tutuca.dev/meta/classes": {
			classes:
				"rounded-box border border-success bg-success/10 border-error bg-error/10 border-warning bg-warning/10 border-base-300 p-2 whitespace-pre-wrap break-all text-left font-mono text-xs text-primary font-bold opacity-70 bg-base-200 text-error max-h-60 overflow-auto",
		},
	},
	defaults: { expected: [], drafts: {}, focus: "" },
	constraints: { filters: { minLength: 1 }, inputs: { minLength: 1 } },
	queries: {
		get counts(): Counts {
			let pass = 0;
			let fail = 0;
			let none = 0;
			let bad = 0;
			for (const f of this.filters) {
				for (const x of this.inputs) {
					const st = cellOf(this.drafts, this.expected, f, x).status;
					if (st === "pass") pass += 1;
					if (st === "fail") fail += 1;
					if (st === "none") none += 1;
					if (st === "error" || st === "invalid") bad += 1;
				}
			}
			return { pass, fail, none, bad };
		},
		get outputs() {
			return this.filters.map((f) => ({
				filter: f.id,
				cells: this.inputs.map((x) => {
					const c = cellOf(this.drafts, this.expected, f, x);
					return { input: x.id, status: c.status, outputs: c.outputs, error: c.error, more: c.more, expected: c.expected };
				}),
			}));
		},
		get gridCells(): GridCell[] {
			const out: GridCell[] = [{ label: "filter \\ input", title: "", status: "label" }];
			for (const x of this.inputs) out.push({ label: x.id, title: "", status: "label" });
			const at = this.filters.findIndex((f) => f.id === this.focus);
			const shown = at < 0 ? 0 : at;
			for (const fi of range(0, this.filters.length)) {
				const f = this.filters[fi];
				if (f === undefined) continue;
				out.push({ label: f.id, title: f.filter, status: fi === shown ? "focused" : "label" });
				for (const x of this.inputs) {
					const cell = cellOf(this.drafts, this.expected, f, x);
					const wanted = cell.expected;
					const title = wanted === null ? "no expectation; click to pin these outputs" : `expected:\n${show(wanted)}\nclick to clear`;
					out.push({ label: clip(cellText(cell), 400), title, status: cell.status });
				}
			}
			return out;
		},
		get gridStyle(): string {
			return `grid-template-columns: max-content repeat(${this.inputs.length}, minmax(8rem, 1fr))`;
		},
		get filterRows() {
			return this.filters.map((f) => ({ id: f.id, filter: f.filter, error: compileError(f.filter) }));
		},
		get inputRows() {
			return this.inputs.map((x) => {
				const d = this.drafts[x.id];
				return d === undefined ? { id: x.id, text: toJson(x.value, 2), error: "" } : { id: x.id, text: d.text, error: d.error };
			});
		},
		get shown(): Shown[] {
			const at = this.filters.findIndex((f) => f.id === this.focus);
			const f = this.filters[at < 0 ? 0 : at] ?? { id: "", filter: "" };
			const out: Shown[] = [];
			for (const x of this.inputs) {
				const cell = cellOf(this.drafts, this.expected, f, x);
				const outputs = cell.outputs;
				if (outputs === null) out.push({ label: `${x.id} outputs`, text: cell.error, status: "error" });
				else out.push({ label: `${x.id} outputs`, text: toJson(outputs, 2), status: "ok" });
				const wanted = cell.expected;
				if (wanted !== null) out.push({ label: `${x.id} expected`, text: toJson(wanted, 2), status: "expected" });
			}
			return out;
		},
		get focusLabel(): string {
			const at = this.filters.findIndex((f) => f.id === this.focus);
			const f = this.filters[at < 0 ? 0 : at];
			return f === undefined ? "" : f.id;
		},
		get headline(): string {
			const c = this.counts;
			return `${c.pass} pass · ${c.fail} fail · ${c.none} unset · ${c.bad} errors`;
		},
		get summary(): string {
			const c = this.counts;
			const lines = [
				`${this.filters.length} filters, ${this.inputs.length} inputs, ${this.expected.length} expectations: ${c.pass} pass, ${c.fail} fail, ${c.none} cells unset, ${c.bad} errors.`,
				"filters:",
			];
			for (const f of this.filters) {
				const why = compileError(f.filter);
				lines.push(`  ${f.id}: ${f.filter}${why === "" ? "" : ` (error: ${firstLine(why)})`}`);
			}
			lines.push("inputs (shapes):");
			for (const x of this.inputs) {
				const sketch = draftError(this.drafts, x.id) === "" ? shapeOf(x.value) : "invalid JSON";
				lines.push(`  ${x.id}: ${clip(sketch, 160)}`);
			}
			lines.push("expected outputs:");
			for (const e of this.expected) lines.push(`  ${e.filter} on ${e.input}: ${clip(show(e.outputs), 120)}`);
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { filters, inputs, expected }. */
		get data(): unknown {
			return { filters: this.filters, inputs: this.inputs, expected: this.expected };
		},
		get domain(): unknown {
			return { filters: this.filters, inputs: this.inputs, expected: this.expected };
		},
		/** A compact type sketch of an input, like {a: number, items: [{id: string}]}. */
		inputShape(input: string): unknown {
			const x = this.inputs.find((it) => it.id === input);
			if (x === undefined) return { error: `no input ${input}` };
			const why = draftError(this.drafts, input);
			if (why !== "") return { error: `${input} isn't JSON: ${why}` };
			return { shape: shapeOf(x.value) };
		},
		/** The part of an input at a JSON pointer: "" for all of it, "/items/0" for the first item. */
		getInput(input: string, pointer: string): unknown {
			const x = this.inputs.find((it) => it.id === input);
			if (x === undefined) return { error: `no input ${input}` };
			const why = draftError(this.drafts, input);
			if (why !== "") return { error: `${input} isn't JSON: ${why}` };
			const r = valueAt(x.value, pointer);
			if (!r.found) return { error: r.error };
			return { value: r.value };
		},
	},
	on: {
		/** Change a filter's jq program. */
		setFilter: {
			pure: true,
			changes: ["filters"],
			pre(prev, [id, filter]: [string, string]) {
				return this.filters.some((f) => f.id === id);
			},
			run(next, [id, filter]: [string, string]) {
				const i = this.filters.findIndex((f) => f.id === id);
				if (i >= 0) next.filters[i] = { id, filter };
			},
		},
		/** Add a filter; it gets the next free id (f1, f2, …). */
		addFilter: {
			pure: true,
			changes: ["filters"],
			post(prev, next, [filter]: [string]) {
				return next.filters.length === prev.filters.length + 1;
			},
			run(next, [filter]: [string]) {
				next.filters.push({ id: nextId(this.filters.map((f) => f.id), "f"), filter });
			},
		},
		/** Remove a filter and its expectations. pre is only checked in dev mode: the last filter
		 * stays. */
		removeFilter: {
			pure: true,
			changes: ["filters", "expected", "focus"],
			pre(prev, [id]: [string]) {
				return this.filters.some((f) => f.id === id) && this.filters.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.filters.length === prev.filters.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.filters.findIndex((f) => f.id === id);
				if (i < 0 || this.filters.length <= 1) return;
				next.filters.splice(i, 1);
				next.expected = this.expected.filter((e) => e.filter !== id);
				if (this.focus === id) next.focus = "";
			},
		},
		/** Move a filter to a position (0 is first). */
		reorderFilters: {
			pure: true,
			changes: ["filters"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.filters.some((f) => f.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.filters.length === prev.filters.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.filters.findIndex((f) => f.id === id);
				if (i < 0) return;
				const order = movedOrder(this.filters.length, i, index);
				next.filters = order.map((j) => this.filters[j] ?? { id: "", filter: "" });
			},
		},
		/** Replace an input's JSON value. */
		setInput: {
			pure: true,
			changes: ["inputs", "drafts"],
			pre(prev, [id, value]: [string, unknown]) {
				return this.inputs.some((x) => x.id === id);
			},
			run(next, [id, value]: [string, unknown]) {
				const i = this.inputs.findIndex((x) => x.id === id);
				if (i < 0) return;
				next.inputs[i] = { id, value };
				next.drafts = without(this.drafts, id);
			},
		},
		/** An input's text, from its editor: the value changes when it is JSON, the text is kept
		 * while it isn't. */
		setInputText: {
			pure: true,
			changes: ["inputs", "drafts"],
			pre(prev, [id, text]: [string, string]) {
				return this.inputs.some((x) => x.id === id);
			},
			run(next, [id, text]: [string, string]) {
				const i = this.inputs.findIndex((x) => x.id === id);
				if (i < 0) return;
				const parsed = parseText(text);
				if (!parsed.ok) {
					next.drafts[id] = { text, error: parsed.error };
					return;
				}
				next.inputs[i] = { id, value: parsed.value };
				next.drafts[id] = { text, error: "" };
			},
		},
		/** Add a JSON input; it gets the next free id (i1, i2, …). */
		addInput: {
			pure: true,
			changes: ["inputs"],
			post(prev, next, [value]: [unknown]) {
				return next.inputs.length === prev.inputs.length + 1;
			},
			run(next, [value]: [unknown]) {
				next.inputs.push({ id: nextId(this.inputs.map((x) => x.id), "i"), value });
			},
		},
		/** From the page: add an input holding {}. */
		newInput: {
			pure: true,
			changes: ["inputs"],
			post(prev, next) {
				return next.inputs.length === prev.inputs.length + 1;
			},
			run(next) {
				const empty: { [key: string]: unknown } = {};
				next.inputs.push({ id: nextId(this.inputs.map((x) => x.id), "i"), value: empty });
			},
		},
		/** Remove an input and its expectations. pre is only checked in dev mode: the last input
		 * stays. */
		removeInput: {
			pure: true,
			changes: ["inputs", "expected", "drafts"],
			pre(prev, [id]: [string]) {
				return this.inputs.some((x) => x.id === id) && this.inputs.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.inputs.length === prev.inputs.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.inputs.findIndex((x) => x.id === id);
				if (i < 0 || this.inputs.length <= 1) return;
				next.inputs.splice(i, 1);
				next.expected = this.expected.filter((e) => e.input !== id);
				next.drafts = without(this.drafts, id);
			},
		},
		/** Move an input to a position (0 is first). */
		reorderInputs: {
			pure: true,
			changes: ["inputs"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.inputs.some((x) => x.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.inputs.length === prev.inputs.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.inputs.findIndex((x) => x.id === id);
				if (i < 0) return;
				const order = movedOrder(this.inputs.length, i, index);
				next.inputs = order.map((j) => this.inputs[j] ?? { id: "", value: null });
			},
		},
		/** Pin what a filter should output for an input: the list of every output, in order ([x]
		 * for a single output x). */
		setExpected: {
			pure: true,
			changes: ["expected"],
			pre(prev, [filter, input, outputs]: [string, string, unknown[]]) {
				return this.filters.some((f) => f.id === filter) && this.inputs.some((x) => x.id === input);
			},
			run(next, [filter, input, outputs]: [string, string, unknown[]]) {
				const i = expectedIndex(this.expected, filter, input);
				if (i >= 0) next.expected[i] = { filter, input, outputs };
				else next.expected.push({ filter, input, outputs });
			},
		},
		/** Remove the expectation of a filter for an input. */
		clearExpected: {
			pure: true,
			changes: ["expected"],
			pre(prev, [filter, input]: [string, string]) {
				return this.expected.some((e) => e.filter === filter && e.input === input);
			},
			post(prev, next, [filter, input]: [string, string]) {
				return next.expected.length === prev.expected.length - 1;
			},
			run(next, [filter, input]: [string, string]) {
				const i = expectedIndex(this.expected, filter, input);
				if (i >= 0) next.expected.splice(i, 1);
			},
		},
		/** From the grid: the cell at index i pins its outputs, or clears its pin. The header row
		 * has a corner and a cell per input, then each filter's row its label and a cell per
		 * input. */
		toggleCell: {
			pure: true,
			changes: ["expected"],
			constraints: { i: { int: true, min: 0 } },
			run(next, [i]: [number]) {
				const width = this.inputs.length + 1;
				const row = Math.floor(i / width) - 1;
				const col = (i % width) - 1;
				const f = this.filters[row];
				const x = this.inputs[col];
				if (row < 0 || col < 0 || f === undefined || x === undefined) return;
				const ei = expectedIndex(this.expected, f.id, x.id);
				if (ei >= 0) {
					next.expected.splice(ei, 1);
					return;
				}
				const outputs = cellOf(this.drafts, this.expected, f, x).outputs;
				if (outputs === null) return;
				next.expected.push({ filter: f.id, input: x.id, outputs });
			},
		},
		/** Which filter the outputs section shows; the focused one again unfocuses it. */
		focus: {
			pure: true,
			changes: ["focus"],
			run(next, [id]: [string]) {
				next.focus = this.focus === id ? "" : id;
			},
		},
		// The rows' own, by the row's key.
		focusAt: {
			pure: true,
			changes: ["focus"],
			constraints: { at: { keyOf: "filters" } },
			run(next, [at]: [number | null]) {
				const f = at === null ? undefined : this.filters[at];
				if (f !== undefined) next.focus = this.focus === f.id ? "" : f.id;
			},
		},
		setFilterAt: {
			pure: true,
			changes: ["filters"],
			constraints: { at: { keyOf: "filters" } },
			run(next, [at, filter]: [number | null, string]) {
				const f = at === null ? undefined : this.filters[at];
				if (at !== null && f !== undefined) next.filters[at] = { id: f.id, filter };
			},
		},
		removeFilterAt: {
			pure: true,
			changes: ["filters", "expected", "focus"],
			constraints: { at: { keyOf: "filters" } },
			run(next, [at]: [number | null]) {
				const f = at === null ? undefined : this.filters[at];
				if (at === null || f === undefined || this.filters.length <= 1) return;
				next.filters.splice(at, 1);
				next.expected = this.expected.filter((e) => e.filter !== f.id);
				if (this.focus === f.id) next.focus = "";
			},
		},
		setInputTextAt: {
			pure: true,
			changes: ["inputs", "drafts"],
			constraints: { at: { keyOf: "inputs" } },
			run(next, [at, text]: [number | null, string]) {
				const x = at === null ? undefined : this.inputs[at];
				if (at === null || x === undefined) return;
				const parsed = parseText(text);
				if (!parsed.ok) {
					next.drafts[x.id] = { text, error: parsed.error };
					return;
				}
				next.inputs[at] = { id: x.id, value: parsed.value };
				next.drafts[x.id] = { text, error: "" };
			},
		},
		removeInputAt: {
			pure: true,
			changes: ["inputs", "expected", "drafts"],
			constraints: { at: { keyOf: "inputs" } },
			run(next, [at]: [number | null]) {
				const x = at === null ? undefined : this.inputs[at];
				if (at === null || x === undefined || this.inputs.length <= 1) return;
				next.inputs.splice(at, 1);
				next.expected = this.expected.filter((e) => e.input !== x.id);
				next.drafts = without(this.drafts, x.id);
			},
		},
	},
	loops: {
		gridCells: {
			enrich(key: number, cell: GridCell) {
				const cls =
					cell.status === "pass"
						? `rounded-box border border-success bg-success/10 ${CELL}`
						: cell.status === "fail"
							? `rounded-box border border-error bg-error/10 ${CELL}`
							: cell.status === "error" || cell.status === "invalid"
								? `rounded-box border border-warning bg-warning/10 ${CELL}`
								: cell.status === "none"
									? `rounded-box border border-base-300 ${CELL}`
									: cell.status === "focused"
										? "font-mono text-xs text-primary font-bold text-left"
										: "font-mono text-xs opacity-70 text-left";
				return { cellClass: cls };
			},
		},
		shown: {
			enrich(key: number, row: Shown) {
				const cls =
					row.status === "error"
						? "rounded-box bg-base-200 p-2 text-xs text-error max-h-60 overflow-auto whitespace-pre-wrap"
						: "rounded-box bg-base-200 p-2 text-xs max-h-60 overflow-auto";
				return { preClass: cls };
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "jq lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Filters"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("filterRows"),
				div(
					{ class: "flex flex-col gap-1" },
					div(
						{ class: "join w-full" },
						button(
							{ class: "btn btn-sm join-item font-mono", title: "Show its outputs", "on:click": send("focusAt", sourceKey()) },
							field("id"),
						),
						h("input", {
							class: "input input-sm input-bordered join-item flex-1 font-mono",
							"aria-label": "Filter",
							value: field("filter"),
							"on:input": send("setFilterAt", sourceKey(), targetValue()),
						}),
						button(
							{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removeFilterAt", sourceKey()) },
							"✕",
						),
					),
					when(field("error"), pre({ class: "text-xs text-error whitespace-pre-wrap" }, field("error"))),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addFilter", ".") }, "+ Filter"),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Inputs"),
		div(
			{ class: "grid gap-2 md:grid-cols-2" },
			each(
				field("inputRows"),
				div(
					{ class: "flex flex-col gap-1" },
					div(
						{ class: "flex items-center justify-between" },
						span({ class: "font-mono text-xs opacity-60" }, field("id")),
						button(
							{ class: "btn btn-xs btn-ghost", title: "Remove", "aria-label": "Remove", "on:click": send("removeInputAt", sourceKey()) },
							"✕",
						),
					),
					textarea({
						class: "textarea textarea-bordered w-full font-mono text-xs",
						rows: "6",
						"aria-label": "Input JSON",
						value: field("text"),
						"on:input": send("setInputTextAt", sourceKey(), targetValue()),
					}),
					when(field("error"), h("p", { class: "text-xs text-error" }, field("error"))),
				),
			),
		),
		button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("newInput") }, "+ Input"),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Outputs"),
		h(
			"p",
			{ class: "text-xs opacity-60" },
			"Green passes, red fails, grey has no expectation. Click a cell to pin its outputs as expected, again to clear.",
		),
		div(
			{ class: "grid gap-1 overflow-x-auto", style: field("gridStyle") },
			each(
				field("gridCells"),
				button({ class: lookupBind("cellClass"), title: field("title"), "on:click": send("toggleCell", sourceKey()) }, field("label")),
				"gridCells",
			),
		),
		h3(
			{ class: "text-xs font-semibold uppercase tracking-wide opacity-60" },
			"Outputs of ",
			span({ class: "font-mono normal-case" }, field("focusLabel")),
		),
		div(
			{ class: "grid gap-2 md:grid-cols-2" },
			each(
				field("shown"),
				div(
					{ class: "flex flex-col gap-1" },
					span({ class: "font-mono text-xs opacity-60" }, field("label")),
					pre({ class: lookupBind("preClass") }, field("text")),
				),
				"shown",
			),
		),
	),
};

export const register = { JqLab: "JqLab" };
