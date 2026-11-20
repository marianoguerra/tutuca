// json-schema-lab: a JSON Schema (draft 2020-12) validated against example documents. Each
// example says whether it should be valid ("pass") or invalid ("fail"); the results show which
// expectations hold and why. The schema and the examples are edited as JSON text, kept while they
// don't parse. Validation runs in the page (microagents/json_schema,
// microagents/engines/json_schema.js, with Ajv). The root's messages are the agent's tools; the
// rows' inputs send messages of their own, by the row's key.
import type { MicroAgent } from "../../kit/kit.tutuca";
import {
	button,
	div,
	each,
	field,
	h2,
	h3,
	header,
	lookupBind,
	p,
	send,
	sourceKey,
	span,
	table,
	targetValue,
	tbody,
	td,
	textarea,
	th,
	thead,
	tr,
	when,
} from "tutuca/view";
import { range, toJson, without } from "tutuca/data";
import { compileError, parse, pointerRemove, pointerSet, validate } from "microagents/json_schema";

/** An example document, with the id the model names it by (e1, e2, …), its value, and whether
 * it should be valid ("pass") or invalid ("fail"). */
export type Example = { id: string; value: unknown; outcome: string };
export type Outcome = "pass" | "fail";
export type ValidationError = { instancePath: string; keyword: string; message: string };
/** An example's result: valid is null when it can't run, status pass, fail or invalid, and error
 * why it can't run ("" when it ran). */
export type Result = { id: string; expected: string; valid: boolean | null; status: string; errors: ValidationError[]; error: string };
export type ResultRow = { id: string; expected: string; actual: string; status: string; errors: string };

/** text cut to at most n characters, with … when it was longer. */
function clip(text: string, n: number): string {
	return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
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

/** "valid", "invalid (n errors)" or the error that kept it from running. */
function verdict(r: Readonly<Result>): string {
	if (r.error !== "") return r.error;
	if (r.valid === true) return "valid";
	return `invalid (${r.errors.length} errors)`;
}

export type JsonSchemaLab = {
	/** The JSON Schema (draft 2020-12) the examples are validated against. */
	schema: unknown;
	/** The schema as the user edits it; "" until it's edited. */
	schemaText: string;
	/** Why schemaText isn't JSON; "" when it is (and schema is its value). */
	schemaError: string;
	/** The example documents, each with an id the model names it by (e1, e2, …), its value, and
	 * whether it should be valid ("pass") or invalid ("fail"). */
	examples: Example[];
	/** Example id → its text as the user edits it, kept while it isn't JSON. */
	exampleTexts: { [key: string]: string };
	/** Example id → why its text isn't JSON. */
	exampleErrors: { [key: string]: string };
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	readonly headline: string;
	/** Why the schema can't be used: "" when it compiles. */
	readonly trouble: string;
	/** Every example's result. */
	readonly results: Result[];
	/** The schema as JSON text, as the editor shows it. */
	readonly schemaEditorText: string;
	/** Why the schema doesn't compile, when it is JSON ("" when it compiles). */
	readonly schemaProblem: string;
	/** The schema's compile error if any, and for every example: expected outcome, whether it is
	 * valid, its status (pass, fail, or invalid when it can't run) and its error count. */
	readonly validation: unknown;
	/** The examples as rows for their editors. */
	readonly exampleRows: { id: string; text: string; pass: boolean; label: string; error: string }[];
	/** The results table's rows. */
	readonly resultRows: ResultRow[];
};

export const JsonSchemaLab = {
	implements: ["MicroAgent"],
	meta: {
		// The status badges' classes, which their loop's enrich computes.
		"https://tutuca.dev/meta/classes": { classes: "badge badge-success badge-error badge-warning" },
	},
	defaults: { schema: null, schemaText: "", schemaError: "", exampleTexts: {}, exampleErrors: {} },
	constraints: { examples: { minLength: 1 } },
	queries: {
		get trouble(): string {
			if (this.schemaError !== "") return `the schema isn't JSON: ${this.schemaError}`;
			const why = compileError(this.schema);
			if (why !== "") return `the schema is invalid: ${why}`;
			return "";
		},
		get results(): Result[] {
			const trouble = this.trouble;
			return this.examples.map((ex) => {
				let error = trouble;
				if (error === "") {
					const bad = this.exampleErrors[ex.id] ?? "";
					if (bad !== "") error = `not JSON: ${bad}`;
				}
				const none: ValidationError[] = [];
				if (error !== "") return { id: ex.id, expected: ex.outcome, valid: null, status: "invalid", errors: none, error };
				const r = validate(this.schema, ex.value);
				if (r.error !== "") {
					return { id: ex.id, expected: ex.outcome, valid: null, status: "invalid", errors: none, error: `the schema is invalid: ${r.error}` };
				}
				const status = r.valid === (ex.outcome !== "fail") ? "pass" : "fail";
				return { id: ex.id, expected: ex.outcome, valid: r.valid, status, errors: r.errors, error: "" };
			});
		},
		get headline(): string {
			const results = this.results;
			const pass = results.filter((r) => r.status === "pass").length;
			const fail = results.filter((r) => r.status === "fail").length;
			const invalid = results.filter((r) => r.status === "invalid").length;
			const out = `${pass} pass · ${fail} fail`;
			return invalid > 0 ? `${out} · ${invalid} can't run` : out;
		},
		get summary(): string {
			const results = this.results;
			const pass = results.filter((r) => r.status === "pass").length;
			const fail = results.filter((r) => r.status === "fail").length;
			const invalid = results.filter((r) => r.status === "invalid").length;
			const trouble = this.trouble;
			const lines = [
				`${results.length} examples: ${pass} pass, ${fail} fail, ${invalid} can't run.`,
				trouble === "" ? "schema:" : `schema (${trouble}):`,
				this.schemaError !== "" ? `  (not JSON: ${this.schemaError})` : `  ${clip(toJson(this.schema, 0), 600)}`,
				"examples:",
			];
			for (const r of results) {
				const ex = this.examples.find((x) => x.id === r.id);
				const value = ex === undefined ? "" : clip(toJson(ex.value, 0), 120);
				lines.push(`  ${r.id}: ${value} expects ${r.expected}, ${verdict(r)} → ${r.status}`);
			}
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { schema, examples }. */
		get data(): unknown {
			return { schema: this.schema, examples: this.examples };
		},
		get domain(): unknown {
			return { schema: this.schema, examples: this.examples };
		},
		get schemaEditorText(): string {
			return this.schemaText !== "" ? this.schemaText : toJson(this.schema, 2);
		},
		get schemaProblem(): string {
			return this.schemaError !== "" ? "" : this.trouble;
		},
		get validation(): unknown {
			const examples = this.results.map((r) => {
				if (r.error !== "") {
					return { id: r.id, expected: r.expected, valid: r.valid, status: r.status, errors: r.errors.length, error: r.error };
				}
				return { id: r.id, expected: r.expected, valid: r.valid, status: r.status, errors: r.errors.length };
			});
			const trouble = this.trouble;
			if (trouble !== "") return { schemaError: trouble, examples };
			return { examples };
		},
		get exampleRows() {
			return this.examples.map((ex) => {
				const pass = ex.outcome !== "fail";
				return {
					id: ex.id,
					text: this.exampleTexts[ex.id] ?? toJson(ex.value, 2),
					pass,
					label: pass ? "should be valid" : "should be invalid",
					error: this.exampleErrors[ex.id] ?? "",
				};
			});
		},
		get resultRows(): ResultRow[] {
			return this.results.map((r) => {
				const actual = r.valid === null ? "—" : r.valid ? "valid" : "invalid";
				const errors =
					r.error !== "" ? r.error : r.errors.map((e) => `${e.instancePath === "" ? "(root)" : e.instancePath}: ${e.message}`).join("\n");
				return { id: r.id, expected: r.expected === "fail" ? "invalid" : "valid", actual, status: r.status, errors };
			});
		},
		/** The validation errors of one example: instancePath, keyword and message for each. */
		errorsFor(id: string): unknown {
			const r = this.results.find((x) => x.id === id);
			if (r === undefined) return { error: `no example ${id}` };
			if (r.error !== "") return { error: r.error };
			return { valid: r.valid, expected: r.expected, errors: r.errors };
		},
	},
	on: {
		/** Replace the whole schema with a JSON value. */
		setSchema: {
			pure: true,
			changes: ["schema", "schemaText", "schemaError"],
			run(next, [schema]: [unknown]) {
				next.schema = schema;
				next.schemaText = "";
				next.schemaError = "";
			},
		},
		/** The schema's text, from its editor: kept while it isn't JSON. */
		setSchemaText: {
			pure: true,
			changes: ["schema", "schemaText", "schemaError"],
			run(next, [text]: [string]) {
				next.schemaText = text;
				const r = parse(text);
				if (r.error !== "") {
					next.schemaError = r.error;
					return;
				}
				next.schema = r.value;
				next.schemaError = "";
			},
		},
		/** Set the value at a JSON Pointer (RFC 6901) in the schema, e.g. "/properties/age/minimum".
		 * The value is JSON as itself (an object, not its JSON text). The parent must exist (set a
		 * missing object whole, e.g. /properties/age to {"type": "integer"}); in an array use an
		 * index or "-" to append; "" replaces the whole schema. */
		patchSchema: {
			pure: true,
			changes: ["schema", "schemaText"],
			pre(prev, [pointer, value]: [string, unknown]) {
				return this.schemaError === "" && pointerSet(this.schema, pointer, null).error === "";
			},
			run(next, [pointer, value]: [string, unknown]) {
				// pre is only checked in dev mode: while the schema's text isn't JSON, editing the last
				// good schema would drop it.
				if (this.schemaError !== "") return;
				const r = pointerSet(this.schema, pointer, value);
				if (r.error !== "") return;
				next.schema = r.value;
				next.schemaText = "";
			},
		},
		/** Remove the value at a JSON Pointer (RFC 6901) in the schema, e.g. "/properties/age" or
		 * "/required/1". */
		removeFromSchema: {
			pure: true,
			changes: ["schema", "schemaText"],
			pre(prev, [pointer]: [string]) {
				return this.schemaError === "" && pointerRemove(this.schema, pointer).error === "";
			},
			run(next, [pointer]: [string]) {
				if (this.schemaError !== "") return;
				const r = pointerRemove(this.schema, pointer);
				if (r.error !== "") return;
				next.schema = r.value;
				next.schemaText = "";
			},
		},
		/** Add an example document; outcome is pass (should be valid) or fail (should be invalid).
		 * It gets the next free id (e1, e2, …). */
		addExample: {
			pure: true,
			changes: ["examples"],
			post(prev, next, [value, outcome]: [unknown, Outcome]) {
				return next.examples.length === prev.examples.length + 1;
			},
			run(next, [value, outcome]: [unknown, Outcome]) {
				next.examples.push({ id: nextId(this.examples.map((x) => x.id), "e"), value, outcome });
			},
		},
		/** From the page: an empty object that should be valid. */
		addBlankExample: {
			pure: true,
			changes: ["examples"],
			post(prev, next) {
				return next.examples.length === prev.examples.length + 1;
			},
			run(next) {
				const blank: { [key: string]: unknown } = {};
				next.examples.push({ id: nextId(this.examples.map((x) => x.id), "e"), value: blank, outcome: "pass" });
			},
		},
		/** Replace an example's document. */
		setExample: {
			pure: true,
			changes: ["examples", "exampleTexts", "exampleErrors"],
			pre(prev, [id, value]: [string, unknown]) {
				return this.examples.some((x) => x.id === id);
			},
			run(next, [id, value]: [string, unknown]) {
				const i = this.examples.findIndex((x) => x.id === id);
				const ex = this.examples[i];
				if (ex === undefined) return;
				next.examples[i] = { id, value, outcome: ex.outcome };
				next.exampleTexts = without(this.exampleTexts, id);
				next.exampleErrors = without(this.exampleErrors, id);
			},
		},
		/** An example's text, from its editor: kept while it isn't JSON. */
		setExampleText: {
			pure: true,
			changes: ["examples", "exampleTexts", "exampleErrors"],
			pre(prev, [id, text]: [string, string]) {
				return this.examples.some((x) => x.id === id);
			},
			run(next, [id, text]: [string, string]) {
				const i = this.examples.findIndex((x) => x.id === id);
				const ex = this.examples[i];
				if (ex === undefined) return;
				next.exampleTexts[id] = text;
				const r = parse(text);
				if (r.error !== "") {
					next.exampleErrors[id] = r.error;
					return;
				}
				next.examples[i] = { id, value: r.value, outcome: ex.outcome };
				next.exampleErrors = without(this.exampleErrors, id);
			},
		},
		/** Remove an example. pre is only checked in dev mode: the last example stays. */
		removeExample: {
			pure: true,
			changes: ["examples", "exampleTexts", "exampleErrors"],
			pre(prev, [id]: [string]) {
				return this.examples.some((x) => x.id === id) && this.examples.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.examples.length === prev.examples.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.examples.findIndex((x) => x.id === id);
				if (i < 0 || this.examples.length <= 1) return;
				next.examples.splice(i, 1);
				next.exampleTexts = without(this.exampleTexts, id);
				next.exampleErrors = without(this.exampleErrors, id);
			},
		},
		/** Move an example to a position (0 is first). */
		reorderExamples: {
			pure: true,
			changes: ["examples"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.examples.some((x) => x.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.examples.length === prev.examples.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.examples.findIndex((x) => x.id === id);
				if (i < 0) return;
				const order = movedOrder(this.examples.length, i, index);
				next.examples = order.map((j) => this.examples[j] ?? { id: "", value: null, outcome: "pass" });
			},
		},
		/** Say whether an example should be valid (pass) or invalid (fail). */
		setExpectation: {
			pure: true,
			changes: ["examples"],
			pre(prev, [id, outcome]: [string, Outcome]) {
				return this.examples.some((x) => x.id === id);
			},
			run(next, [id, outcome]: [string, Outcome]) {
				const i = this.examples.findIndex((x) => x.id === id);
				const ex = this.examples[i];
				if (ex !== undefined) next.examples[i] = { id, value: ex.value, outcome };
			},
		},
		// The rows' own, by the row's key.
		flipExpectationAt: {
			pure: true,
			changes: ["examples"],
			constraints: { at: { keyOf: "examples" } },
			run(next, [at]: [number | null]) {
				const ex = at === null ? undefined : this.examples[at];
				if (at !== null && ex !== undefined) next.examples[at] = { id: ex.id, value: ex.value, outcome: ex.outcome === "fail" ? "pass" : "fail" };
			},
		},
		removeExampleAt: {
			pure: true,
			changes: ["examples", "exampleTexts", "exampleErrors"],
			constraints: { at: { keyOf: "examples" } },
			run(next, [at]: [number | null]) {
				const ex = at === null ? undefined : this.examples[at];
				if (at === null || ex === undefined || this.examples.length <= 1) return;
				next.examples.splice(at, 1);
				next.exampleTexts = without(this.exampleTexts, ex.id);
				next.exampleErrors = without(this.exampleErrors, ex.id);
			},
		},
		setExampleTextAt: {
			pure: true,
			changes: ["examples", "exampleTexts", "exampleErrors"],
			constraints: { at: { keyOf: "examples" } },
			run(next, [at, text]: [number | null, string]) {
				const ex = at === null ? undefined : this.examples[at];
				if (at === null || ex === undefined) return;
				next.exampleTexts[ex.id] = text;
				const r = parse(text);
				if (r.error !== "") {
					next.exampleErrors[ex.id] = r.error;
					return;
				}
				next.examples[at] = { id: ex.id, value: r.value, outcome: ex.outcome };
				next.exampleErrors = without(this.exampleErrors, ex.id);
			},
		},
	},
	loops: {
		resultRows: {
			enrich(key: number, row: ResultRow) {
				const cls = row.status === "pass" ? "badge badge-success" : row.status === "fail" ? "badge badge-error" : "badge badge-warning";
				return { statusClass: cls };
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "JSON Schema lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Schema"),
		textarea({
			class: "textarea textarea-bordered w-full font-mono text-xs",
			rows: "12",
			"aria-label": "Schema JSON",
			value: field("schemaEditorText"),
			"on:input": send("setSchemaText", targetValue()),
		}),
		when(field("schemaError"), p({ class: "text-xs text-error" }, field("schemaError"))),
		when(field("schemaProblem"), p({ class: "text-xs text-error" }, field("schemaProblem"))),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Examples"),
		div(
			{ class: "flex flex-col gap-2" },
			each(
				field("exampleRows"),
				div(
					{ class: "flex flex-col gap-1 rounded-box border border-base-300 p-2" },
					div(
						{ class: "flex items-center gap-2" },
						span({ class: "font-mono text-xs opacity-70" }, field("id")),
						button(
							{
								class: when(field("pass"), "btn btn-xs btn-success", "btn btn-xs btn-error"),
								title: "Click to flip the expectation",
								"on:click": send("flipExpectationAt", sourceKey()),
							},
							field("label"),
						),
						button(
							{ class: "btn btn-xs btn-ghost ml-auto", title: "Remove", "aria-label": "Remove", "on:click": send("removeExampleAt", sourceKey()) },
							"✕",
						),
					),
					textarea({
						class: "textarea textarea-bordered w-full font-mono text-xs",
						rows: "3",
						"aria-label": "Example JSON",
						value: field("text"),
						"on:input": send("setExampleTextAt", sourceKey(), targetValue()),
					}),
					when(field("error"), p({ class: "text-xs text-error" }, field("error"))),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addBlankExample") }, "+ Example"),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Results"),
		table(
			{ class: "table table-sm" },
			thead({}, tr({}, th({}, "example"), th({}, "expected"), th({}, "actual"), th({}, ""), th({}, "errors"))),
			tbody(
				{},
				each(
					field("resultRows"),
					tr(
						{},
						td({ class: "font-mono text-xs" }, field("id")),
						td({}, field("expected")),
						td({}, field("actual")),
						td({}, span({ class: lookupBind("statusClass") }, field("status"))),
						td({ class: "whitespace-pre-wrap font-mono text-xs" }, field("errors")),
					),
					"resultRows",
				),
			),
		),
	),
};

export const register = { JsonSchemaLab: "JsonSchemaLab" };
