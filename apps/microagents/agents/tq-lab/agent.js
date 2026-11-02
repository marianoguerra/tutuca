// tq-lab: tq queries run against sample tdata messages. A sample part (kind "tdata-sample")
// holds one child message, so any tdata (Typed, Node, Sets, Doubles…) can be carried; the
// workspace edits it as tdata JSON text. Each sample can say, per query id, whether the query
// should match it (meta dialect https://tutuca.dev/d/expect, "match" or "no-match"). The grid
// shows which expectations pass, and the focused query's solutions and bindings per sample.
export default function define(kit) {
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
	const { message, messages, queries, encodeMessage, encodeValue } = kit.tdata;
	const { decodeMessage, isMessage, kindOf } = kit.tdata;
	const { json, parts, expect, grid } = kit.lib;
	const { labHeader, section, gridView, jsonViewArgs, listHandlers, listOf } = kit.ui;
	const { div, p, span, textarea } = tag;
	const MAX_SOLUTIONS = 50;
	const CLIP = 600;

	const clip = (s) => json.clip(s, CLIP);
	// The query's parse error ("line N, col N" included), or "".
	const parseError = json.memo((q) => {
		try {
			queries.parse(q);
			return "";
		} catch (e) {
			return e.message;
		}
	}, 512);
	// { msg, error } for a sample's tdata JSON text.
	const sampleOf = json.memo((text) => {
		try {
			return { msg: decodeMessage(text), error: "" };
		} catch (e) {
			return { msg: null, error: e.message };
		}
	}, 512);
	// What a query found, as tdata JSON text: a message, a list of messages or a value.
	const show = (found) => {
		if (isMessage(found)) return encodeMessage(found);
		if (Array.isArray(found) && found.length > 0 && found.every(isMessage)) {
			return `[${found.map((m) => encodeMessage(m)).join(",")}]`;
		}
		return encodeValue(found);
	};
	const truthy = (v) => v !== false && v !== null;
	// { matched, solutions: [{ value, text, truthy, bindings: [{ name, value, text }] }], error,
	// more } of query text q on the sample text (keyed q\0text); value is text clipped.
	const runKey = json.memo((key) => {
		const at = key.indexOf("\u0000");
		const q = key.slice(0, at);
		const error = parseError(q);
		const { msg, error: sampleError } = sampleOf(key.slice(at + 1));
		if (error || sampleError) {
			return { matched: null, solutions: [], error: error || sampleError, more: false };
		}
		try {
			const all = queries.run(q, msg);
			const solutions = all.slice(0, MAX_SOLUTIONS).map((s) => {
				const text = show(s.value);
				return {
					value: clip(text),
					text,
					truthy: truthy(s.value),
					bindings: [...s.bindings].map(([name, v]) => {
						const shown = show(v);
						return { name: `$${name}`, value: clip(shown), text: shown };
					}),
				};
			});
			const matched = all.some((s) => truthy(s.value));
			return { matched, solutions, error: "", more: all.length > MAX_SOLUTIONS };
		} catch (e) {
			return { matched: null, solutions: [], error: e.message, more: false };
		}
	}, 2000);
	const runOn = (q, text) => runKey(`${q}\u0000${text}`);

	// Canonical tdata JSON indented for reading: containers longer than 60 characters break one
	// entry per line. Number tokens are copied as they are, so 1 and 1.0 stay apart (which
	// JSON.stringify can't do, hence not lib.json.pretty).
	const pretty = (text) => {
		const close = new Map();
		const stack = [];
		let inString = false;
		for (let i = 0; i < text.length; i++) {
			const c = text[i];
			if (inString) {
				if (c === "\\") i++;
				else if (c === '"') inString = false;
			} else if (c === '"') inString = true;
			else if (c === "{" || c === "[") stack.push(i);
			else if (c === "}" || c === "]") close.set(stack.pop(), i);
		}
		let out = "";
		let depth = 0;
		const breaks = [];
		const nl = () => `\n${"  ".repeat(depth)}`;
		inString = false;
		for (let i = 0; i < text.length; i++) {
			const c = text[i];
			if (inString) {
				out += c;
				if (c === "\\") out += text[++i];
				else if (c === '"') inString = false;
			} else if (c === '"') {
				inString = true;
				out += c;
			} else if (c === "{" || c === "[") {
				const broken = close.get(i) - i > 60;
				breaks.push(broken);
				if (broken) depth++;
				out += broken ? c + nl() : c;
			} else if (c === "}" || c === "]") {
				if (breaks.pop()) {
					depth--;
					out += nl() + c;
				} else out += c;
			} else if (c === ",") out += breaks.at(-1) ? `,${nl()}` : ",";
			else if (c === ":") out += breaks.at(-1) ? ": " : ":";
			else out += c;
		}
		return out;
	};
	// A run's solutions as one tdata JSON object, { "1": { value, bindings? }, … }: every
	// solution and binding is tdata JSON text, so the whole is too (and JSON, for a JsonView).
	const solutionsText = (r) => {
		const entries = r.solutions.map((s, i) => {
			const binds = s.bindings.map((b) => `${JSON.stringify(b.name)}:${b.text}`).join(",");
			return `"${i + 1}":{"value":${s.text}${binds ? `,"bindings":{${binds}}` : ""}}`;
		});
		return pretty(`{${entries.join(",")}}`);
	};

	// The tq paths in a message or value, each with the kinds found there.
	const fieldPath = (path, k) =>
		/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? `${path}.${k}` : `${path}.${JSON.stringify(k)}`;
	const shapeOf = (msg) => {
		const out = new Map();
		const add = (path, kind) => {
			if (!out.has(path)) out.set(path, new Set());
			out.get(path).add(kind);
		};
		const walkValue = (v, path) => {
			const kind = kindOf(v) ?? typeof v;
			if (kind === "typed") {
				add(path, `typed ${JSON.stringify(v.typeId)}`);
				walkValue(v.value, `${path}.value`);
			} else if (kind === "node") {
				add(path, `node <${v.tag}>`);
				for (const [k, a] of v.attributes) walkValue(a, fieldPath(`${path}.attrs`, k));
				for (const c of v.children) walkValue(c, `${path}.children[]`);
			} else {
				add(path, kind);
				if (v instanceof Map) for (const [k, x] of v) walkValue(x, fieldPath(path, k));
				else if (Array.isArray(v) || v instanceof Set) for (const x of v) walkValue(x, `${path}[]`);
			}
		};
		const walkMessage = (m, path) => {
			add(path || ".", `message (kind ${JSON.stringify(m.kind)})`);
			add(`${path}.id`, "string");
			add(`${path}.kind`, "string");
			if (m.messages !== undefined) {
				add(`${path}.messages`, "messages");
				for (const c of m.messages) walkMessage(c, `${path}.messages[]`);
			} else walkValue(m.data, `${path}.data`);
			for (const [dialect, headers] of m.meta ?? []) {
				for (const [h, v] of headers)
					add(fieldPath(fieldPath(`${path}.meta`, dialect), h), kindOf(v));
			}
		};
		walkMessage(msg, "");
		return [...out].slice(0, 300).map(([path, kinds]) => `${path}: ${[...kinds].join(" | ")}`);
	};

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

	const QueryRow = component({
		name: "QueryRow",
		fields: { id: t.string(), query: t.string() },
		queries: {
			get error() {
				return parseError(this.query);
			},
			get hasError() {
				return this.error !== "";
			},
		},
		view: div(
			{ class: "flex flex-col gap-1" },
			div(
				{ class: "join w-full items-stretch" },
				button(
					{
						class: "btn btn-sm join-item h-auto font-mono",
						title: "Show its solutions",
						"on:click": send("pick"),
					},
					field("id"),
				),
				textarea({
					class: "textarea textarea-sm textarea-bordered join-item flex-1 font-mono",
					rows: 2,
					"aria-label": "Query",
					value: field("query"),
					"on:input": send("editQuery", targetValue()),
				}),
			),
			$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
		),
		on: {
			set_query: {
				pure: true,
				args: [t.string()],
				run(next, [query]) {
					next.query = query;
				},
			},
			editQuery: {
				args: [t.string()],
				emits: { notify: ["set_query"] },
				run(_next, [query], ctx) {
					ctx.notify("set_query", [this.id, query]);
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

	// A sample's message is edited in a JsonView (tdata JSON is JSON), which notifies set_sample.
	const sampleArgs = (id, text) => ({
		id,
		label: id,
		text,
		mode: "tree",
		rows: 6,
		editable: true,
		on: "set_sample",
	});
	const SampleCase = component({
		name: "SampleCase",
		fields: {
			id: t.string(),
			expect: t.map(t.enum(...expect.OUTCOMES)),
			view: t.component("JsonView"),
		},
		queries: {
			get text() {
				return this.view.text;
			},
			get error() {
				return sampleOf(this.text).error;
			},
			// The error when the text is JSON but not a tdata message (the view says JSON errors).
			get tdataError() {
				return json.parse(this.text).error === "" ? this.error : "";
			},
			get hasTdataError() {
				return this.tdataError !== "";
			},
		},
		view: div(
			{ class: "flex flex-col gap-1" },
			render(field("view")),
			$if(field("hasTdataError"), p({ class: "text-xs text-error" }, field("tdataError")), ""),
		),
		on: {
			set_text: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					next.view = apply(next.view, "set_text", text);
				},
			},
			// What the sample should do for queryId; "none" drops it.
			set_expectation: {
				pure: true,
				args: [t.string(), t.enum("match", "no-match", "none")],
				run(next, [queryId, outcome]) {
					if (outcome === "none") delete next.expect[queryId];
					else next.expect[queryId] = outcome;
				},
			},
			cycle_expectation: {
				pure: true,
				args: [t.string()],
				run(next, [queryId]) {
					next.expect = expect.cycle(this.expect, queryId);
				},
			},
		},
	});

	// Applies the pure message name to the sample with id, if there is one.
	const toSample = (self, next, id, name, ...args) => {
		const i = self.samples.items.findIndex((x) => x.id === id);
		if (i >= 0) next.samples.items[i] = apply(next.samples.items[i], name, ...args);
	};

	// A new query or sample, with the next free id. A sample's text is shown pretty when it is a
	// tdata message.
	const newQuery = (self, ctx, query) =>
		ctx.scope.make("QueryRow", { id: parts.nextId("q", self.queries.items), query });
	const newSample = (self, ctx, text) => {
		const { msg } = sampleOf(text);
		const id = parts.nextId("s", self.samples.items);
		const shown = msg === null ? text : pretty(encodeMessage(msg));
		return ctx.scope.make("SampleCase", {
			id,
			expect: {},
			view: ctx.scope.make("JsonView", sampleArgs(id, shown)),
		});
	};
	// After a query is removed: the expectations that name it go too.
	const queryRemoved = (_self, next, query) => {
		next.samples.items = next.samples.items.map((x) =>
			x.expect[query.id] === undefined ? x : apply(x, "set_expectation", query.id, "none"),
		);
	};

	const TqLab = component({
		name: "TqLab",
		fields: {
			queries: t.component("List"),
			samples: t.component("List"),
			focus: t.string(), // The query whose solutions show; "" for the first.
			views: t.array(t.component("JsonView")), // The focused query's solutions (wantedViews).
		},
		methods: {
			queryById(id) {
				return this.queries.items.find((q) => q.id === id);
			},
			sampleById(id) {
				return this.samples.items.find((x) => x.id === id);
			},
			// One cell: { status: pass | fail | none | invalid, matched, expected }.
			cell(sample, query) {
				const { matched } = runOn(query.query, sample.text);
				const expected = sample.expect[query.id] ?? "none";
				return { status: expect.status(expected, matched), matched, expected };
			},
			// view tool: a query's solutions on a sample. query is a query id, or tq text to try
			// without saving it.

			// view tool: the tq paths in a sample's message and the kinds found at each.

			toDomain() {
				return {
					queries: this.queries.items.map(({ id, query }) => ({ id, query })),
					samples: this.samples.items.map(({ id, text, expect }) => ({
						id,
						text,
						expect: { ...expect },
					})),
				};
			},
		},
		queries: {
			run(queryRef, sampleId) {
				const x = this.sampleById(sampleId);
				if (x === undefined) return { error: `no sample ${sampleId}` };
				const q = this.queryById(queryRef)?.query ?? queryRef;
				const r = runOn(q, x.text);
				if (r.error) return { error: r.error };
				return {
					matched: r.matched,
					solutions: r.solutions.map((s) => ({
						value: s.value,
						bindings: Object.fromEntries(s.bindings.map((b) => [b.name, b.value])),
					})),
					...(r.more ? { note: `only the first ${MAX_SOLUTIONS} solutions` } : {}),
				};
			},
			sample_shape(sampleId) {
				const x = this.sampleById(sampleId);
				if (x === undefined) return { error: `no sample ${sampleId}` };
				const { msg, error } = sampleOf(x.text);
				return msg === null ? { error } : { paths: shapeOf(msg) };
			},

			get focused() {
				return this.queryById(this.focus) ?? this.queries.items[0];
			},
			get focusLabel() {
				return this.focused?.id ?? "no query";
			},
			// view tool: every sample × query.
			get grid() {
				return this.samples.items.map((sample) => ({
					sample: sample.id,
					cells: this.queries.items.map((q) => ({ query: q.id, ...this.cell(sample, q) })),
				}));
			},
			// The grid as status cells: a row per sample, a column per query.
			get statusGrid() {
				return grid.grid({
					rows: this.samples.items,
					cols: this.queries.items,
					corner: "sample",
					rowLabel: (x) => x.id,
					colLabel: (q) => q.id,
					cell: (sample, query) => {
						const c = this.cell(sample, query);
						return {
							status: c.status,
							label: c.matched === null ? "error" : c.matched ? "matches" : "no match",
							title: `expected: ${c.expected}; click to change`,
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
			// The focused query on each sample.
			get results() {
				const q = this.focused;
				return this.samples.items.map((x) => {
					const r = q === undefined ? null : runOn(q.query, x.text);
					return {
						id: x.id,
						label: r === null ? "" : r.error ? "error" : r.matched ? "matches" : "no match",
						error: r?.error ?? "",
						solutions: (r?.solutions ?? []).map((s) => ({
							...s,
							cls: s.truthy ? "" : "opacity-50",
						})),
						text: r === null ? "" : r.error ? r.error : solutionsText(r),
						more: r?.more ?? false,
					};
				});
			},
			// The views the solutions section has: one per sample, its solutions and bindings.
			get wantedViews() {
				if (this.focused === undefined) return [];
				return this.results.map((r) => {
					const k = r.solutions.length;
					const n = r.error ? "" : ` · ${k}${r.more ? "+" : ""} solution${k === 1 ? "" : "s"}`;
					return jsonViewArgs(r.text, { id: `sol:${r.id}`, label: `${r.id} · ${r.label}${n}` });
				});
			},
			get counts() {
				const cells = this.grid.flatMap((row) => row.cells);
				const of = (s) => cells.filter((c) => c.status === s).length;
				return {
					pass: of("pass"),
					fail: of("fail"),
					unset: of("none"),
					invalid: of("invalid"),
				};
			},
			get headline() {
				const c = this.counts;
				return `${c.pass} pass · ${c.fail} fail · ${c.unset} unset`;
			},
			get summary() {
				const c = this.counts;
				const qs = this.queries.items.map(
					(q) => `  ${q.id}: ${q.query}${q.error ? ` (error: ${q.error})` : ""}`,
				);
				const samples = this.samples.items.map((x) => {
					const { msg, error } = sampleOf(x.text);
					const what = msg === null ? `invalid: ${error}` : `message ${msg.id} of kind ${msg.kind}`;
					return `  ${x.id}: ${what}; expects ${JSON.stringify(x.expect)}`;
				});
				return [
					`${this.queries.items.length} queries, ${this.samples.items.length} samples: ${c.pass} expectations pass, ${c.fail} fail, ${c.unset} cells have no expectation, ${c.invalid} invalid.`,
					"queries:",
					...qs,
					"samples:",
					...samples,
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("tq lab"),
			section("Queries"),
			render(field("queries")),
			section("Samples"),
			render(field("samples")),
			section("Expectations"),
			p(
				{ class: "text-xs opacity-60" },
				"Click a cell to cycle its expectation: none → match → no match.",
			),
			gridView("grid", "cycle_cell"),
			section("Solutions of ", span({ class: "font-mono normal-case" }, field("focusLabel"))),
			div({ class: "flex flex-col gap-2" }, renderEach(field("views"))),
		),
		on: syncing({
			...listHandlers("queries", {
				make: (self, ctx) => newQuery(self, ctx, "."),
				removed: queryRemoved,
			}),
			...listHandlers("samples", {
				make: (self, ctx) => newSample(self, ctx, '{"id":"m","kind":"note","data":null}'),
			}),
			set_query: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.queryById(id) !== undefined,
				run(next, [id, query]) {
					const i = this.queries.items.findIndex((q) => q.id === id);
					next.queries.items[i] = apply(next.queries.items[i], "set_query", query);
				},
			},
			add_query: {
				args: [t.string()],
				run(next, [query], ctx) {
					next.queries = apply(next.queries, "add_item", newQuery(this, ctx, query));
				},
			},
			remove_query: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.queryById(id) !== undefined,
				run(next, [id]) {
					const i = this.queries.items.findIndex((q) => q.id === id);
					next.queries = apply(next.queries, "remove_item_at", i);
					queryRemoved(this, next, this.queries.items[i]);
				},
			},
			add_sample: {
				args: [t.string()],
				run(next, [text], ctx) {
					next.samples = apply(next.samples, "add_item", newSample(this, ctx, text));
				},
			},
			// From a sample's JsonView too: [id, text] as it is edited.
			set_sample: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.sampleById(id) !== undefined,
				run(next, [id, text]) {
					toSample(this, next, id, "set_text", text);
				},
			},
			remove_sample: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.sampleById(id) !== undefined,
				run(next, [id]) {
					const i = this.samples.items.findIndex((x) => x.id === id);
					next.samples = apply(next.samples, "remove_item_at", i);
				},
			},
			set_expectation: {
				pure: true,
				args: [t.string(), t.string(), t.enum("match", "no-match", "none")],
				pre: (self, [s, q]) => self.sampleById(s) !== undefined && self.queryById(q) !== undefined,
				run(next, [sampleId, queryId, outcome]) {
					toSample(this, next, sampleId, "set_expectation", queryId, outcome);
				},
			},
			// From the grid: the cell at index i of gridCells moves none → match → no-match → none.
			cycle_cell: {
				pure: true,
				args: [t.number().int().min(0)],
				run(next, [i]) {
					const at = this.statusGrid.at(i);
					if (at === null) return;
					next.samples.items[at.row] = apply(
						next.samples.items[at.row],
						"cycle_expectation",
						this.queries.items[at.col].id,
					);
				},
			},
			focus: {
				pure: true,
				args: [t.string()],
				run(next, [id]) {
					next.focus = id;
				},
			},
		}),
	});

	// How the chat shows a set_query call: the query as id = text, and on how many samples it
	// matches in the grid it answers with, opening to each sample's cell.
	const SetQueryCall = component({
		name: "SetQueryCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get query() {
				const { id = "?", query = "" } = this.call?.arguments ?? {};
				return `${id} = ${query}`;
			},
			// The query's cell on each sample in the result: [{ sample, status, matched, expected }].
			get cells() {
				const value = this.resultJson;
				const id = this.call?.arguments?.id;
				if (!Array.isArray(value)) return [];
				return value.flatMap((row) => {
					const c = (row.cells ?? []).find((x) => x.query === id);
					return c === undefined ? [] : [{ sample: row.sample, ...c }];
				});
			},
			get lines() {
				return this.cells.map((c) => ({
					text: `${c.sample}: ${c.matched === null ? "error" : c.matched ? "matches" : "no match"} (expected ${c.expected})`,
					cls: `font-mono text-xs ${c.status === "fail" ? "text-error" : ""}`,
				}));
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				const n = this.cells.filter((c) => c.matched).length;
				const statuses = this.cells.map((c) => c.status);
				return `matches ${n}/${this.cells.length} · ${expect.headline(statuses)}`;
			},
			get stateClass() {
				return kit.ui.callStateClass(
					this.result,
					this.cells.some((c) => c.status === "fail"),
				);
			},
		}),
		view: kit.ui.toolCallFrame(
			"query",
			each(field("lines"), p({ class: field("cls") }, field("text"))),
		),
	});

	// A sample part's message as indented tdata JSON; "" when it holds none.
	const sampleText = (m) => (m.messages?.length > 0 ? pretty(encodeMessage(m.messages[0])) : "");
	const expectOf = (m) => expect.read(m, { accept: expect.OUTCOMES });

	// The root for msg. Queries come from the query's bindings (or the parts of that kind when
	// it decodes without them); samples are always read from msg itself, so their messages keep
	// every detail they were written with.
	const decode = (C, bindings, msg) => {
		const fields = {
			queries: listOf(
				C,
				"queries",
				(bindings.queries ?? parts.kidsOf(msg, "tq")).map((m) =>
					C.QueryRow({ id: m.id, query: parts.strOf(m, "query") }),
				),
				{ addLabel: "Query" },
			),
			samples: listOf(
				C,
				"samples",
				parts.kidsOf(msg, "tdata-sample").map((m) =>
					C.SampleCase({
						id: m.id,
						expect: expectOf(m),
						view: C.JsonView(sampleArgs(m.id, sampleText(m))),
					}),
				),
				{ addLabel: "Sample" },
			),
		};
		const views = C.TqLab(fields).wantedViews.map((w) => C.JsonView(w));
		return C.TqLab({ ...fields, views });
	};

	// A sample's text as its child list; a text that doesn't decode keeps the old one.
	const childrenOf = (text, old) => {
		const { msg } = sampleOf(text);
		return msg === null ? old : [msg];
	};

	// msg with root's queries and samples: unchanged parts stay the same objects, removed ones
	// go, new ones are added at the end, and parts of other kinds stay where they are.
	const encode = (root, msg) =>
		parts.encodeParts(msg, {
			tq: {
				items: root.queries.items,
				ordered: true,
				same: (m, q) => parts.strOf(m, "query") === q.query,
				update: (m, q) => parts.withData(m, { query: q.query }),
				create: (q) => message(q.id, "tq", new Map([["query", q.query]])),
			},
			"tdata-sample": {
				items: root.samples.items,
				ordered: true,
				same: (m, x) => sampleText(m) === x.text && expect.same(expectOf(m), x.expect),
				update: (m, x) => {
					const sameText = sampleText(m) === x.text;
					const sameMeta = expect.same(expectOf(m), x.expect);
					const children = sameText ? (m.messages ?? []) : childrenOf(x.text, m.messages ?? []);
					return messages(
						m.id,
						m.kind,
						children,
						sameMeta ? m.meta : expect.withAll(m.meta, x.expect),
					);
				},
				create: (x) =>
					messages(x.id, "tdata-sample", childrenOf(x.text, []), expect.metaFor(x.expect)),
			},
		});

	return {
		components: { ...kit.ui.components, QueryRow, SampleCase, TqLab, SetQueryCall },
		root: "TqLab",
		decode,
		encode,
		toolViews: { set_query: "SetQueryCall" },
	};
}
