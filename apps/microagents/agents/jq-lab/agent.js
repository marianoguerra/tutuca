// jq-lab: jq filters run against JSON inputs. The grid shows each filter's outputs on each
// input, and an expected-output part (kind "jq-expected", {filter, input, outputs}) pins what a
// filter should give for an input, so the grid says pass or fail. jq-wasm is loaded once in
// define and used through its synchronous handle, so getters compute outputs directly; results
// are remembered by filter and input text.
export default async function define(kit) {
	const {
		$if,
		apply,
		button,
		component,
		each,
		field,
		render,
		renderEach,
		scopeOf,
		send,
		t,
		tag,
		targetValue,
	} = kit.tutuca;
	const { message, toJson, fromJson, dataJson } = kit.tdata;
	const { json, parts, expect, grid } = kit.lib;
	const { labHeader, section, gridView, jsonViewArgs, listHandlers, listOf } = kit.ui;
	const { div, input, p, pre, span } = tag;
	const jq = await (await kit.engines.jq()).loadJq();
	const MAX_OUTPUTS = 100;
	const CLIP = 400;

	const cleanError = (text) => text.replace(/^jq: error \(at [^)]*\): /, "").trim();
	// The filter's syntax error, or "". Running it on null only compiles it when it's wrong.
	const compileError = json.memo((filter) => {
		if (filter.trim() === "") return "the filter is empty";
		const r = jq.raw("null", filter);
		return /compile error/.test(r.stderr) ? r.stderr.trim() : "";
	}, 512);
	const inputError = (text) => json.parse(text).error;
	// { outputs, error, more } of filter on the input text (keyed filter\0text); outputs is null on
	// an error. The filter runs inside limit() so a filter with endless outputs stops.
	const runKey = json.memo((key) => {
		const at = key.indexOf("\u0000");
		const filter = key.slice(0, at);
		const text = key.slice(at + 1);
		const error = compileError(filter);
		if (error) return { outputs: null, error, more: false };
		const parsed = inputError(text);
		if (parsed) return { outputs: null, error: `the input isn't JSON: ${parsed}`, more: false };
		try {
			const outputs = jq.json(text, `limit(${MAX_OUTPUTS + 1};\n${filter}\n)`);
			const more = outputs.length > MAX_OUTPUTS;
			return { outputs: more ? outputs.slice(0, MAX_OUTPUTS) : outputs, error: "", more };
		} catch (e) {
			return { outputs: null, error: cleanError(e.message ?? String(e)), more: false };
		}
	}, 2000);
	const run = (filter, text) => runKey(`${filter}\u0000${text}`);

	// JSON text with object keys sorted, to compare values whatever their key order.
	const canon = (v) => JSON.stringify(sortKeys(v));
	const sortKeys = (v) =>
		Array.isArray(v)
			? v.map(sortKeys)
			: json.isObject(v)
				? Object.fromEntries(
						Object.keys(v)
							.sort()
							.map((k) => [k, sortKeys(v[k])]),
					)
				: v;
	const clip = (s) => json.clip(s, CLIP);
	const showOutputs = (outputs) => outputs.map((o) => JSON.stringify(o)).join("\n");

	// A compact type sketch of a JSON value: {a: number, items: [{id: string}]}.
	const shapeOf = (v, depth = 0) => {
		if (v === null) return "null";
		if (Array.isArray(v)) {
			if (v.length === 0) return "[]";
			if (depth > 6) return "[…]";
			const kinds = [...new Set(v.slice(0, 50).map((x) => shapeOf(x, depth + 1)))];
			return `[${kinds.slice(0, 4).join(" | ")}${kinds.length > 4 ? " | …" : ""}]`;
		}
		if (typeof v === "object") {
			if (depth > 6) return "{…}";
			const keys = Object.keys(v);
			const items = keys.slice(0, 40).map((k) => `${k}: ${shapeOf(v[k], depth + 1)}`);
			return `{${items.join(", ")}${keys.length > 40 ? ", …" : ""}}`;
		}
		return typeof v;
	};

	// An input is an editable JsonView; its edits come back as set_input_text.
	const inputArgs = (id, text) => ({
		id,
		label: id,
		text,
		mode: "tree",
		rows: 6,
		editable: true,
		on: "set_input_text",
	});
	// views (a draft list of JsonViews) made to show wanted ([{ id, label, text }]): when the ids
	// are the same, in order, each view keeps its state (raw or tree, folds) and gets the new text.
	const syncViews = (views, wanted, make) => {
		if (views.length === wanted.length && wanted.every((w, i) => views[i].id === w.id)) {
			for (const [i, w] of wanted.entries()) {
				if (views[i].label !== w.label) views[i] = apply(views[i], "set_label", w.label);
				if (views[i].text !== w.text) views[i] = apply(views[i], "set_text", w.text);
			}
		} else views.splice(0, views.length, ...wanted.map(make));
	};
	// handlers that, after they run, bring the root's views up to date with what they changed.
	const syncing = (handlers) =>
		Object.fromEntries(
			Object.entries(handlers).map(([name, h]) => [
				name,
				{
					...h,
					// A pure handler stays pure: the views are made in the component's own scope.
					run: h.pure
						? function (next, args) {
								h.run.call(this, next, args);
								syncViews(next.views, next.wantedViews, (w) => scopeOf(this).make("JsonView", w));
							}
						: function (next, args, ctx) {
								h.run.call(this, next, args, ctx);
								syncViews(next.views, next.wantedViews, (w) => scopeOf(this).make("JsonView", w));
							},
				},
			]),
		);

	const FilterRow = component({
		name: "FilterRow",
		fields: { id: t.string(), filter: t.string() },
		queries: {
			get error() {
				return compileError(this.filter);
			},
			get hasError() {
				return this.error !== "";
			},
		},
		view: div(
			{ class: "flex flex-col gap-1" },
			div(
				{ class: "join w-full" },
				button(
					{ class: "btn btn-sm join-item font-mono", title: "Focus", "on:click": send("pick") },
					field("id"),
				),
				input({
					class: "input input-sm input-bordered join-item flex-1 font-mono",
					"aria-label": "Filter",
					value: field("filter"),
					"on:input": send("editFilter", targetValue()),
				}),
			),
			$if(field("hasError"), pre({ class: "text-xs text-error" }, field("error")), ""),
		),
		on: {
			set_filter: {
				pure: true,
				args: [t.string()],
				run(next, [filter]) {
					next.filter = filter;
				},
			},
			editFilter: {
				args: [t.string()],
				emits: { notify: ["set_filter"] },
				run(_next, [filter], ctx) {
					ctx.notify("set_filter", [this.id, filter]);
				},
			},
			pick: {
				args: [],
				emits: { notify: ["focus"] },
				run(_next, _args, ctx) {
					ctx.notify("focus", [this.id]);
				},
			},
		},
	});

	const CELL = {
		pass: "rounded-box border border-success bg-success/10 p-2",
		fail: "rounded-box border border-error bg-error/10 p-2",
		error: "rounded-box border border-warning bg-warning/10 p-2",
		invalid: "rounded-box border border-warning bg-warning/10 p-2",
		none: "rounded-box border border-base-300 p-2",
	};

	// A new filter or input, with the next free id.
	const newFilter = (self, ctx, filter) =>
		ctx.scope.make("FilterRow", { id: parts.nextId("f", self.filters.items), filter });
	const newInput = (self, ctx, text) =>
		ctx.scope.make("JsonView", inputArgs(parts.nextId("i", self.inputs.items), text));
	// After a filter or an input is removed: the expectations that name it go too.
	const filterRemoved = (self, next, filter) => {
		next.expected = self.expected.filter((e) => e.filter !== filter.id);
	};
	const inputRemoved = (self, next, input) => {
		next.expected = self.expected.filter((e) => e.input !== input.id);
	};

	const JqLab = component({
		name: "JqLab",
		fields: {
			filters: t.component("List"),
			inputs: t.component("List"),
			expected: t.array(t.any()), // { id, filter, input, outputs }
			focus: t.string(), // The filter whose row the cells highlight; "" for none.
			views: t.array(t.component("JsonView")), // The focused filter's outputs (wantedViews).
		},
		methods: {
			filterById(id) {
				return this.filters.items.find((f) => f.id === id);
			},
			inputById(id) {
				return this.inputs.items.find((x) => x.id === id);
			},
			expectedFor(filterId, inputId) {
				return this.expected.find((e) => e.filter === filterId && e.input === inputId);
			},
			// One cell: { status, outputs, error, expected }. status is pass or fail when an expectation
			// is pinned, else none, error (jq failed) or invalid (the filter or the input doesn't parse).
			cell(filter, inp) {
				const r = run(filter.filter, inp.text);
				const exp = this.expectedFor(filter.id, inp.id);
				const expected = exp === undefined ? null : exp.outputs;
				let status;
				if (r.outputs === null && exp !== undefined) status = "fail";
				else if (compileError(filter.filter) !== "" || inputError(inp.text) !== "")
					status = "invalid";
				else if (r.outputs === null) status = "error";
				else if (exp === undefined) status = "none";
				else status = canon(r.outputs) === canon(expected) ? "pass" : "fail";
				return { status, outputs: r.outputs, error: r.error, more: r.more, expected };
			},
			// An input's JSON: { value } or { error }.
			inputValue(inputId) {
				const x = this.inputById(inputId);
				if (x === undefined) return { error: `no input ${inputId}` };
				const { value, error } = json.parse(x.text);
				return error ? { error: `${inputId} isn't JSON: ${error}` } : { value };
			},
			// view tool: a compact type sketch of an input.

			// view tool: the part of an input at a JSON pointer.

			toDomain() {
				return {
					filters: this.filters.items.map(({ id, filter }) => ({ id, filter })),
					inputs: this.inputs.items.map(({ id, text }) => {
						const { value, error } = json.parse(text);
						return error ? { id, text } : { id, value };
					}),
					expected: this.expected.map((e) => ({ ...e })),
				};
			},
		},
		queries: {
			input_shape(inputId) {
				const r = this.inputValue(inputId);
				return r.error ? r : { shape: shapeOf(r.value) };
			},
			get_input(inputId, pointer) {
				const r = this.inputValue(inputId);
				if (r.error) return r;
				const at = json.pointer.resolve(r.value, pointer ?? "");
				return at.resolves ? { value: at.value } : { error: `nothing at ${pointer}: ${at.reason}` };
			},

			// view tool: every filter × input.
			get outputs() {
				return this.filters.items.map((f) => ({
					filter: f.id,
					cells: this.inputs.items.map((x) => ({ input: x.id, ...this.cell(f, x) })),
				}));
			},
			// The outputs as a status grid: a row per filter, a column per input.
			get statusGrid() {
				const rows = this.outputs;
				return grid.grid({
					rows,
					cols: this.inputs.items.map((x) => x.id),
					corner: "filter \\ input",
					rowLabel: (row) => row.filter,
					columns: "minmax(8rem, 1fr)",
					cell: (row, inputId) => {
						const c = row.cells.find((x) => x.input === inputId);
						const shown = c.outputs === null ? c.error : showOutputs(c.outputs) || "(no output)";
						const focused = row.filter === this.focus ? " ring-2 ring-primary" : "";
						return {
							status: c.status,
							label: clip(shown + (c.more ? "\n…" : "")),
							cls: `${CELL[c.status]}${focused} whitespace-pre-wrap break-all text-left font-mono text-xs`,
							title:
								c.expected === null
									? "no expectation; click to pin these outputs"
									: `expected:\n${showOutputs(c.expected)}\nclick to clear`,
							// A cell with neither outputs to pin nor a pin to clear can't be clicked.
							fixed: c.outputs === null && c.expected === null,
						};
					},
				});
			},
			get gridCells() {
				return this.statusGrid.cells;
			},
			get gridStyle() {
				return this.statusGrid.gridStyle;
			},
			// The filter the outputs section shows: the focused one, or the first.
			get shown() {
				return this.filterById(this.focus) ?? this.filters.items[0];
			},
			get shownLabel() {
				return this.shown?.id ?? "no filter";
			},
			// The views the outputs section has: per input, the shown filter's outputs (or its error)
			// and, when one is pinned, the expected outputs.
			get wantedViews() {
				const f = this.shown;
				if (f === undefined) return [];
				return this.inputs.items.flatMap((x) => {
					const c = this.cell(f, x);
					const out = jsonViewArgs(c.outputs === null ? c.error : json.pretty(c.outputs), {
						id: `out:${x.id}`,
						label: `${x.id} outputs`,
					});
					if (c.expected === null) return [out];
					const exp = jsonViewArgs(c.expected, {
						id: `exp:${x.id}`,
						label: `${x.id} expected`,
					});
					return [out, exp];
				});
			},
			get counts() {
				const cells = this.outputs.flatMap((row) => row.cells);
				const of = (s) => cells.filter((c) => c.status === s).length;
				return {
					pass: of("pass"),
					fail: of("fail"),
					unset: of("none"),
					error: of("error") + of("invalid"),
				};
			},
			get headline() {
				const statuses = this.outputs.flatMap((row) => row.cells.map((c) => c.status));
				return expect.headline(statuses, { always: true, invalid: "errors" });
			},
			get summary() {
				const c = this.counts;
				const filters = this.filters.items.map((f) => {
					const e = compileError(f.filter);
					return `  ${f.id}: ${f.filter}${e ? ` (error: ${e.split("\n")[0]})` : ""}`;
				});
				const inputs = this.inputs.items.map((x) => {
					const { value, error } = json.parse(x.text);
					const shape = error ? "invalid JSON" : shapeOf(value);
					return `  ${x.id}: ${clip(shape).slice(0, 160)}`;
				});
				const expected = this.expected.map(
					(e) => `  ${e.filter} on ${e.input}: ${clip(showOutputs(e.outputs)).slice(0, 120)}`,
				);
				return [
					`${this.filters.items.length} filters, ${this.inputs.items.length} inputs, ${this.expected.length} expectations: ${c.pass} pass, ${c.fail} fail, ${c.unset} cells unset, ${c.error} errors.`,
					"filters:",
					...filters,
					"inputs (shapes):",
					...inputs,
					"expected outputs:",
					...expected,
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("jq lab"),
			section("Filters"),
			render(field("filters")),
			section("Inputs"),
			render(field("inputs")),
			section("Outputs"),
			p(
				{ class: "text-xs opacity-60" },
				"Green passes, red fails, grey has no expectation. Click a cell to pin its outputs as expected, again to clear.",
			),
			gridView("grid", "toggle_cell"),
			section("Outputs of ", span({ class: "font-mono normal-case" }, field("shownLabel"))),
			div({ class: "grid gap-2 md:grid-cols-2" }, renderEach(field("views"))),
		),
		on: syncing({
			...listHandlers("filters", {
				make: (self, ctx) => newFilter(self, ctx, "."),
				removed: filterRemoved,
			}),
			...listHandlers("inputs", {
				make: (self, ctx) => newInput(self, ctx, "{}"),
				removed: inputRemoved,
			}),
			set_filter: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.filterById(id) !== undefined,
				run(next, [id, filter]) {
					const i = this.filters.items.findIndex((f) => f.id === id);
					next.filters.items[i] = apply(next.filters.items[i], "set_filter", filter);
				},
			},
			add_filter: {
				args: [t.string()],
				run(next, [filter], ctx) {
					next.filters = apply(next.filters, "add_item", newFilter(this, ctx, filter));
				},
			},
			remove_filter: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.filterById(id) !== undefined,
				run(next, [id]) {
					const i = this.filters.items.findIndex((f) => f.id === id);
					next.filters = apply(next.filters, "remove_item_at", i);
					filterRemoved(this, next, this.filters.items[i]);
				},
			},
			set_input: {
				pure: true,
				args: [t.string(), t.any()],
				pre: (self, [id]) => self.inputById(id) !== undefined,
				run(next, [id, value]) {
					const i = this.inputs.items.findIndex((x) => x.id === id);
					next.inputs.items[i] = apply(next.inputs.items[i], "set_text", json.pretty(value));
				},
			},
			// From an input's JsonView too: [id, text] as it is edited.
			set_input_text: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.inputById(id) !== undefined,
				run(next, [id, text]) {
					const i = this.inputs.items.findIndex((x) => x.id === id);
					next.inputs.items[i] = apply(next.inputs.items[i], "set_text", text);
				},
			},
			add_input: {
				args: [t.any()],
				run(next, [value], ctx) {
					next.inputs = apply(
						next.inputs,
						"add_item",
						newInput(this, ctx, json.pretty(value ?? null)),
					);
				},
			},
			remove_input: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.inputById(id) !== undefined,
				run(next, [id]) {
					const i = this.inputs.items.findIndex((x) => x.id === id);
					next.inputs = apply(next.inputs, "remove_item_at", i);
					inputRemoved(this, next, this.inputs.items[i]);
				},
			},
			set_expected: {
				pure: true,
				args: [t.string(), t.string(), t.array(t.any())],
				pre: (self, [f, i]) => self.filterById(f) !== undefined && self.inputById(i) !== undefined,
				run(next, [filter, inputId, outputs]) {
					const i = this.expected.findIndex((e) => e.filter === filter && e.input === inputId);
					const value = JSON.parse(JSON.stringify(outputs));
					if (i >= 0) next.expected[i].outputs = value;
					else
						next.expected.push({
							id: parts.nextId("e", this.expected),
							filter,
							input: inputId,
							outputs: value,
						});
				},
			},
			clear_expected: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [f, i]) => self.expectedFor(f, i) !== undefined,
				run(next, [filter, inputId]) {
					next.expected = this.expected.filter(
						(e) => !(e.filter === filter && e.input === inputId),
					);
				},
			},
			// From the grid: the cell at index i of gridCells pins its outputs, or clears its pin.
			toggle_cell: {
				pure: true,
				args: [t.number().int().min(0)],
				run(next, [i]) {
					const at = this.statusGrid.at(i);
					const f = this.filters.items[at?.row];
					const x = this.inputs.items[at?.col];
					if (f === undefined || x === undefined) return;
					const exp = this.expectedFor(f.id, x.id);
					if (exp !== undefined) {
						next.expected = this.expected.filter((e) => e !== exp);
						return;
					}
					const { outputs } = run(f.filter, x.text);
					if (outputs === null) return;
					next.expected.push({
						id: parts.nextId("e", this.expected),
						filter: f.id,
						input: x.id,
						outputs: JSON.parse(JSON.stringify(outputs)),
					});
				},
			},
			focus: {
				pure: true,
				args: [t.string()],
				run(next, [id]) {
					next.focus = this.focus === id ? "" : id;
				},
			},
		}),
	});

	// How the chat shows a set_filter call: the filter as id = program, and how its row of the
	// grid it answers with fares, opening to each input's outputs.
	const SetFilterCall = component({
		name: "SetFilterCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get filter() {
				const { id = "?", filter = "" } = this.call?.arguments ?? {};
				return `${id} = ${filter}`;
			},
			// The cells of the filter's row in the result, or [].
			get cells() {
				const value = this.resultJson;
				const id = this.call?.arguments?.id;
				const row = Array.isArray(value) ? value.find((r) => r.filter === id) : undefined;
				return Array.isArray(row?.cells) ? row.cells : [];
			},
			get lines() {
				return this.cells.map((c) => ({
					text: `${c.input} (${c.status}): ${c.outputs === null ? c.error : json.preview(c.outputs, 100)}`,
					cls: `font-mono text-xs ${c.status === "fail" ? "text-error" : c.status === "pass" ? "text-success" : ""}`,
				}));
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				return expect.headline(this.cells.map((c) => c.status));
			},
			get stateClass() {
				return kit.ui.callStateClass(
					this.result,
					this.cells.some((c) => c.status === "fail"),
				);
			},
		}),
		view: kit.ui.toolCallFrame(
			"filter",
			each(field("lines"), p({ class: field("cls") }, field("text"))),
		),
	});

	const inputText = (m) => json.pretty(dataJson(m));
	// An expected-output part as { id, filter, input, outputs }: "outputs" is the list of every
	// output, "output" the single one.
	const expectedOf = (m) => {
		const d = m.data instanceof Map ? m.data : new Map();
		let outputs = [];
		try {
			if (d.has("outputs")) outputs = toJson(d.get("outputs"));
			else if (d.has("output")) outputs = [toJson(d.get("output"))];
		} catch {}
		return {
			id: m.id,
			filter: parts.strOf(m, "filter"),
			input: parts.strOf(m, "input"),
			outputs,
		};
	};

	// The root for msg: its filter, input and expected parts (the query's bindings, or the parts
	// of each kind when it decodes without them, as the empty sample does).
	const decode = (C, bindings, msg) => {
		const fields = {
			filters: listOf(
				C,
				"filters",
				(bindings.filters ?? parts.kidsOf(msg, "jq")).map((m) =>
					C.FilterRow({ id: m.id, filter: parts.strOf(m, "filter") }),
				),
				{ addLabel: "Filter" },
			),
			inputs: listOf(
				C,
				"inputs",
				(bindings.inputs ?? parts.kidsOf(msg, "json")).map((m) =>
					C.JsonView(inputArgs(m.id, inputText(m))),
				),
				{ addLabel: "Input" },
			),
			expected: (bindings.expected ?? parts.kidsOf(msg, "jq-expected")).map(expectedOf),
		};
		const views = C.JqLab(fields).wantedViews.map((w) => C.JsonView(w));
		return C.JqLab({ ...fields, views });
	};

	const inputData = (text) => {
		const { value, error } = json.parse(text);
		return error ? text : fromJson(value); // Not JSON yet: kept as the text, so nothing is lost.
	};
	const expectedData = (e, old) => {
		const data = new Map(old ?? []);
		data.delete("output");
		data.set("filter", e.filter);
		data.set("input", e.input);
		data.set("outputs", fromJson(e.outputs));
		return data;
	};

	// msg with root's filters, inputs and expected outputs: unchanged parts stay the same
	// objects, removed ones go, new ones are added at the end, other kinds stay where they are.
	const encode = (root, msg) =>
		parts.encodeParts(msg, {
			jq: {
				items: root.filters.items,
				ordered: true,
				same: (m, f) => parts.strOf(m, "filter") === f.filter,
				update: (m, f) => parts.withData(m, { filter: f.filter }),
				create: (f) => message(f.id, "jq", new Map([["filter", f.filter]])),
			},
			json: {
				items: root.inputs.items,
				ordered: true,
				same: (m, x) => inputText(m) === x.text,
				update: (m, x) => ({ ...m, data: inputData(x.text) }),
				create: (x) => message(x.id, "json", inputData(x.text)),
			},
			"jq-expected": {
				items: root.expected,
				same: (m, e) => canon(expectedOf(m)) === canon(e),
				update: (m, e) => ({ ...m, data: expectedData(e, m.data instanceof Map ? m.data : null) }),
				create: (e) => message(e.id, "jq-expected", expectedData(e, null)),
			},
		});

	return {
		components: { ...kit.ui.components, FilterRow, JqLab, SetFilterCall },
		root: "JqLab",
		decode,
		encode,
		toolViews: { set_filter: "SetFilterCall" },
	};
}
