// json-schema-lab: a JSON Schema (a "json-schema" part) validated against example documents
// ("json-example" parts). Each example says whether it should be valid (meta dialect
// https://tutuca.dev/d/expect, header outcome: "pass") or invalid ("fail"); the results table
// shows which expectations hold. The schema and the examples are kept as JSON text, so the page
// can show a parse error while someone types; the root's handlers are the agent's tools, and
// the rows' editors notify the same handlers.
export default async function define(kit) {
	const { apply, button, component, each, field, $if, render, send, t, tag } = kit.tutuca;
	const { dataJson, fromJson, message } = kit.tdata;
	const { div, p, span, table, tbody, td, th, thead, tr } = tag;
	const { Ajv2020, addFormats } = await kit.engines.ajv();
	const { expect } = kit.lib;
	const { clip, memo, parse, pointer, pretty, preview, sameAsPart } = kit.lib.json;
	const { encodeParts, kidsOf, nextId, withJsonPart } = kit.lib.parts;
	const { labHeader, listHandlers, listOf, section } = kit.ui;
	const OUTCOMES = ["pass", "fail"];

	// { validate, error }: the schema in text compiled by a fresh Ajv (a schema's $id may only
	// be added once to an Ajv), or why it can't be.
	const compileSchema = memo((text) => {
		if (text.trim() === "") return { validate: null, error: "there is no schema yet" };
		const { value, error } = parse(text);
		if (error) return { validate: null, error: `the schema isn't JSON: ${error}` };
		try {
			const ajv = new Ajv2020({ allErrors: true, strict: false });
			addFormats(ajv);
			return { validate: ajv.compile(value), error: "" };
		} catch (e) {
			return { validate: null, error: `the schema is invalid: ${e.message}` };
		}
	}, 16);
	// { valid, errors, error }: one example's text against the schema's text. valid is null
	// when either can't be used, and error says why.
	const check = memo((key) => {
		const [schemaText, exampleText] = key.split("\u0000");
		const { validate, error } = compileSchema(schemaText);
		if (validate === null) return { valid: null, errors: [], error };
		const parsed = parse(exampleText);
		if (parsed.error) return { valid: null, errors: [], error: `not JSON: ${parsed.error}` };
		const valid = validate(parsed.value);
		const errors = (validate.errors ?? []).map(({ instancePath, keyword, message }) => ({
			instancePath,
			keyword,
			message,
		}));
		return { valid, errors, error: "" };
	});

	// The args of an editable JsonView: its edits notify on with [id, text].
	const editorArgs = (id, text, on, label, rows) => ({
		id,
		label,
		text,
		mode: "tree",
		editable: true,
		on,
		rows,
	});
	const exampleEditor = (id, text) => editorArgs(id, text, "set_example_text", "Example JSON", 3);
	const schemaEditor = (text) => editorArgs("schema", text, "set_schema_text", "Schema JSON", 12);
	// The schema's text, in the root and in its editor.
	const setSchema = (next, text) => {
		next.schemaText = text;
		next.schemaView = apply(next.schemaView, "set_text", text);
	};
	// Example i's text, in the row and in its editor.
	const setExample = (next, i, text) => {
		next.examples.items[i] = apply(next.examples.items[i], "set_text", text);
	};

	const ExampleRow = component({
		name: "ExampleRow",
		fields: {
			id: t.string(),
			text: t.string(),
			outcome: t.enum(...OUTCOMES),
			view: t.component("JsonView"), // The text's editor.
		},
		queries: {
			get outcomeLabel() {
				return this.outcome === "pass" ? "should be valid" : "should be invalid";
			},
			get outcomeClass() {
				return this.outcome === "pass" ? "btn btn-xs btn-success" : "btn btn-xs btn-error";
			},
		},
		view: div(
			{ class: "flex flex-col gap-1 rounded-box border border-base-300 p-2" },
			div(
				{ class: "flex items-center gap-2" },
				span({ class: "font-mono text-xs opacity-70" }, field("id")),
				button(
					{
						class: field("outcomeClass"),
						title: "Click to flip the expectation",
						"on:click": send("flip"),
					},
					field("outcomeLabel"),
				),
			),
			render(field("view")),
		),
		on: {
			// The text, here and in its editor.
			set_text: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					next.text = text;
					next.view = apply(next.view, "set_text", text);
				},
			},
			set_outcome: {
				pure: true,
				args: [t.enum(...OUTCOMES)],
				run(next, [outcome]) {
					next.outcome = outcome;
				},
			},
			flip: {
				args: [],
				emits: { notify: ["set_expectation"] },
				run(_next, _args, ctx) {
					ctx.notify("set_expectation", [this.id, this.outcome === "pass" ? "fail" : "pass"]);
				},
			},
		},
	});

	// A new example with the next free id.
	const newExample = (self, ctx, text, outcome) => {
		const id = nextId("e", self.examples.items);
		const view = ctx.scope.make("JsonView", exampleEditor(id, text));
		return ctx.scope.make("ExampleRow", { id, text, outcome, view });
	};

	const JsonSchemaLab = component({
		name: "JsonSchemaLab",
		fields: {
			schemaId: t.string(), // The schema part's id; "" until there is one.
			schemaText: t.string(),
			schemaView: t.component("JsonView"), // The schema's editor.
			examples: t.component("List"),
			...kit.ui.pagerFields(), // The results table's page.
		},
		queries: kit.ui.mix(
			kit.ui.pagerQueries("rows"),
			{
				get schemaError() {
					return compileSchema(this.schemaText).error;
				},
				// The schema's error when it is JSON (its editor says what's wrong with the JSON).
				get schemaProblem() {
					return parse(this.schemaText).error === "" ? this.schemaError : "";
				},
				get hasSchemaProblem() {
					return this.schemaProblem !== "";
				},
				// One result per example: { id, expected, valid, status, errors, error }.
				get results() {
					return this.examples.items.map((x) => {
						const r = check(`${this.schemaText}\u0000${x.text}`);
						const status =
							r.valid === null ? "invalid" : r.valid === (x.outcome === "pass") ? "pass" : "fail";
						return { id: x.id, expected: x.outcome, ...r, status };
					});
				},
				// The results table's rows.
				get rows() {
					return this.results.map((r) => ({
						id: r.id,
						expected: r.expected === "pass" ? "valid" : "invalid",
						actual: r.valid === null ? "—" : r.valid ? "valid" : "invalid",
						cls: expect.BADGE[r.status],
						status: r.status,
						errors:
							r.error ||
							r.errors.map((e) => `${e.instancePath || "(root)"}: ${e.message}`).join("\n"),
					}));
				},
				get counts() {
					const of = (s) => this.results.filter((r) => r.status === s).length;
					return { pass: of("pass"), fail: of("fail"), invalid: of("invalid") };
				},
				get headline() {
					const c = this.counts;
					return `${c.pass} pass · ${c.fail} fail${c.invalid > 0 ? ` · ${c.invalid} can't run` : ""}`;
				},
				// view tool: the schema's state and every example's result.
				get validation() {
					return {
						schemaError: this.schemaError || undefined,
						examples: this.results.map(({ id, expected, valid, status, errors, error }) => ({
							id,
							expected,
							valid,
							status,
							errors: errors.length,
							...(error ? { error } : {}),
						})),
					};
				},
				get summary() {
					const c = this.counts;
					const schema = parse(this.schemaText);
					const schemaLine = schema.error
						? `  (not JSON: ${schema.error})`
						: `  ${clip(JSON.stringify(schema.value), 600)}`;
					const examples = this.results.map(
						(r) =>
							`  ${r.id}: ${clip(this.exampleById(r.id).text.replace(/\s+/g, " "), 120)} expects ${r.expected}, ${r.valid === null ? r.error : r.valid ? "valid" : `invalid (${r.errors.length} errors)`} → ${r.status}`,
					);
					return [
						`schema ${this.schemaId || "(none)"}, ${this.examples.items.length} examples: ${c.pass} pass, ${c.fail} fail, ${c.invalid} can't run.`,
						`schema${this.schemaError ? ` (${this.schemaError})` : ""}:`,
						schemaLine,
						"examples:",
						...examples,
					].join("\n");
				},
			},
			{
				errors_for(id) {
					const r = this.results.find((x) => x.id === id);
					if (r === undefined) return { error: `no example ${id}` };
					if (r.error) return { error: r.error };
					return { valid: r.valid, expected: r.expected, errors: r.errors };
				},
			},
		),
		methods: {
			exampleById(id) {
				return this.examples.items.find((x) => x.id === id);
			},
			// view tool: why an example is valid or not.

			toDomain() {
				const json = (text) => parse(text).value ?? null;
				return {
					schema: json(this.schemaText),
					examples: this.examples.items.map(({ id, text, outcome }) => ({
						id,
						value: json(text),
						outcome,
					})),
				};
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("JSON Schema lab"),
			section("Schema"),
			render(field("schemaView")),
			$if(
				field("hasSchemaProblem"),
				p({ class: "text-xs text-error" }, field("schemaProblem")),
				"",
			),
			section("Examples"),
			render(field("examples")),
			section("Results"),
			kit.ui.pagerView(),
			table(
				{ class: "table table-sm" },
				thead(tr(th("example"), th("expected"), th("actual"), th(""), th("errors"))),
				tbody(
					each(
						field("pagedRows"),
						tr(
							td({ class: "font-mono text-xs" }, field("id")),
							td(field("expected")),
							td(field("actual")),
							td(span({ class: field("cls") }, field("status"))),
							td({ class: "whitespace-pre-wrap font-mono text-xs" }, field("errors")),
						),
					),
				),
			),
		),
		on: {
			...kit.ui.pagerHandlers(),
			// From the page: an empty example that should pass.
			...listHandlers("examples", { make: (self, ctx) => newExample(self, ctx, "{}", "pass") }),
			set_schema: {
				pure: true,
				args: [t.any()],
				pre: (_self, [schema]) => schema !== undefined,
				run(next, [schema]) {
					setSchema(next, pretty(schema));
				},
			},
			// From the schema's editor: [its id, the text].
			set_schema_text: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [, text]) {
					setSchema(next, text);
				},
			},
			patch_schema: {
				pure: true,
				args: [t.string(), t.any()],
				pre: (self, [at, value]) => {
					const schema = parse(self.schemaText);
					return (
						value !== undefined &&
						schema.error === "" &&
						pointer.set(schema.value, at, value).error === undefined
					);
				},
				why: (self, [at, value]) => {
					const schema = parse(self.schemaText);
					if (value === undefined) return "it needs a value";
					if (schema.error !== "") return `the schema isn't JSON: ${schema.error}`;
					return pointer.set(schema.value, at, value).error ?? "";
				},
				run(next, [at, value]) {
					setSchema(next, pretty(pointer.set(parse(this.schemaText).value, at, value).value));
				},
			},
			add_example: {
				args: [t.any(), t.enum(...OUTCOMES)],
				pre: (_self, [value]) => value !== undefined,
				run(next, [value, outcome], ctx) {
					next.examples = apply(
						next.examples,
						"add_item",
						newExample(this, ctx, pretty(value), outcome),
					);
				},
			},
			set_example: {
				pure: true,
				args: [t.string(), t.any()],
				pre: (self, [id, value]) => self.exampleById(id) !== undefined && value !== undefined,
				run(next, [id, value]) {
					setExample(
						next,
						this.examples.items.findIndex((x) => x.id === id),
						pretty(value),
					);
				},
			},
			set_example_text: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.exampleById(id) !== undefined,
				run(next, [id, text]) {
					setExample(
						next,
						this.examples.items.findIndex((x) => x.id === id),
						text,
					);
				},
			},
			remove_example: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.exampleById(id) !== undefined,
				run(next, [id]) {
					const i = this.examples.items.findIndex((x) => x.id === id);
					next.examples = apply(next.examples, "remove_item_at", i);
				},
			},
			set_expectation: {
				pure: true,
				args: [t.string(), t.enum(...OUTCOMES)],
				pre: (self, [id]) => self.exampleById(id) !== undefined,
				run(next, [id, outcome]) {
					const i = this.examples.items.findIndex((x) => x.id === id);
					next.examples.items[i] = apply(next.examples.items[i], "set_outcome", outcome);
				},
			},
		},
	});

	// An example's expected outcome; "pass" when it doesn't say.
	const outcomeOf = (m) => (expect.get(m, "outcome") === "fail" ? "fail" : "pass");
	const textOf = (m) => pretty(dataJson(m));

	// The root for msg: the first schema part and every example part (the query's bindings, or
	// the parts of those kinds when it decodes without them, as the empty sample does).
	const decode = (C, bindings, msg) => {
		const schema = (bindings.schemas ?? kidsOf(msg, "json-schema"))[0];
		const schemaText = schema === undefined ? "" : textOf(schema);
		return C.JsonSchemaLab({
			schemaId: schema?.id ?? "",
			schemaText,
			schemaView: C.JsonView(schemaEditor(schemaText)),
			examples: listOf(
				C,
				"examples",
				(bindings.examples ?? kidsOf(msg, "json-example")).map((m) => {
					const text = textOf(m);
					const view = C.JsonView(exampleEditor(m.id, text));
					return C.ExampleRow({ id: m.id, text, outcome: outcomeOf(m), view });
				}),
				{ addLabel: "Example" },
			),
		});
	};

	// msg with root's schema and examples, written losslessly (kit.lib.parts.encodeParts). Text
	// that isn't JSON leaves its part as it was (a new example that isn't JSON is left out).
	const encode = (root, msg) => {
		const sameData = (m, x) => parse(x.text).error !== "" || sameAsPart(m, x.text);
		const withSchema = withJsonPart(msg, {
			kind: "json-schema",
			id: root.schemaId,
			text: root.schemaText,
			newId: "s1",
		});
		return encodeParts(withSchema, {
			"json-example": {
				items: root.examples.items,
				ordered: true,
				same: (m, x) => sameData(m, x) && outcomeOf(m) === x.outcome,
				update: (m, x) => ({
					...m,
					data: sameData(m, x) ? m.data : fromJson(parse(x.text).value),
					meta:
						outcomeOf(m) === x.outcome
							? m.meta
							: expect.withHeader(m.meta, expect.DIALECT, "outcome", x.outcome),
				}),
				create: (x) =>
					parse(x.text).error !== ""
						? null
						: message(
								x.id,
								"json-example",
								fromJson(parse(x.text).value),
								expect.metaFor({ outcome: x.outcome }),
							),
			},
		});
	};

	// How the chat shows a set_schema or patch_schema call: what it sets (the pointer and a
	// glimpse of the value) and how the examples fare after it, opening to the ones that don't
	// pass. call and result are pi's toolCall block and toolResult message (null while it runs).
	const SchemaEditCall = component({
		name: "SchemaEditCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get change() {
				const args = this.call?.arguments ?? {};
				if (this.toolName !== "patch_schema") return `schema = ${preview(args.schema, 200)}`;
				const at = args.pointer === "" ? '"" (the whole schema)' : (args.pointer ?? "?");
				return `${at} = ${preview(args.value, 200)}`;
			},
			// The validation the call answers with, or null.
			get validation() {
				if (this.result === null || this.result === undefined || this.result.isError) return null;
				return this.resultJson;
			},
			get statuses() {
				return (this.validation?.examples ?? []).map((x) => x.status);
			},
			// The schema's error and the examples that don't pass, one line each.
			get problems() {
				const v = this.validation;
				if (v === null) return [];
				const lines = v.schemaError ? [{ text: v.schemaError }] : [];
				for (const x of v.examples ?? []) {
					if (x.status === "pass") continue;
					const got =
						x.valid === null ? x.error : x.valid ? "valid" : `invalid (${x.errors} errors)`;
					lines.push({
						text: `${x.id}: expected ${x.expected === "pass" ? "valid" : "invalid"}, ${got}`,
					});
				}
				return lines;
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				if (this.validation?.schemaError) return "the schema doesn't compile";
				return expect.headline(this.statuses);
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, this.problems.length > 0);
			},
		}),
		view: kit.ui.toolCallFrame(
			"change",
			each(field("problems"), p({ class: "font-mono text-xs text-error" }, field("text"))),
		),
	});

	return {
		components: { ...kit.ui.components, ExampleRow, JsonSchemaLab, SchemaEditCall },
		root: "JsonSchemaLab",
		decode,
		encode,
		toolViews: { set_schema: "SchemaEditCall", patch_schema: "SchemaEditCall" },
	};
}
