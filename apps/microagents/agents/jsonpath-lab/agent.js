// jsonpath-lab: JSONPath expressions ("jsonpath" parts, data {path}) run against one JSON
// document (a "json" part). A path may say how many results it should give (meta dialect
// https://tutuca.dev/d/expect, header count). The page shows the document as a tree with the
// focused path's matches highlighted, and each path's results. The document is kept as JSON
// text, so the page can show a parse error while someone types. The root's handlers are the
// agent's tools; the rows' inputs notify the same handlers.
export default async function define(kit) {
	const { apply, button, component, each, field, $if, render, send, t, tag, targetValue } =
		kit.tutuca;
	const { dataJson, message } = kit.tdata;
	const { div, input, p, span } = tag;
	const { JSONPath } = await kit.engines.jsonpath();
	const { expect } = kit.lib;
	const { clip, indent, memo, nodes, parse, pretty, preview } = kit.lib.json;
	const { encodeParts, kidsOf, nextId, strOf, withData, withJsonPart } = kit.lib.parts;
	const { jsonText, labHeader, listHandlers, listOf, section } = kit.ui;
	const MAX_RESULTS = 200;
	const MAX_ROWS = 1500;

	// { value, error }: the document's text parsed. The value is shared: never mutate it.
	const parseDoc = (text) => parse(text, { emptyError: "there is no document yet" });

	// Why path isn't a JSONPath, or "". jsonpath-plus accepts almost anything (an unknown name
	// just matches nothing), so this catches the slips it lets through.
	const pathProblem = (path) => {
		if (path.trim() === "") return "the path is empty";
		if (!path.trimStart().startsWith("$")) return "a path starts with $ (the document's root)";
		const open = [];
		let quote = "";
		let escaped = false;
		for (const ch of path) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (quote !== "") quote = ch === quote ? "" : quote;
			else if (ch === "'" || ch === '"') quote = ch;
			else if (ch === "[" || ch === "(") open.push(ch);
			else if (ch === "]" || ch === ")") {
				const want = ch === "]" ? "[" : "(";
				if (open.pop() !== want) return `a ${ch} has no ${want} before it`;
			}
		}
		if (quote !== "") return `a ${quote} quote isn't closed`;
		if (open.length > 0) return `a ${open.at(-1)} isn't closed`;
		return "";
	};
	// { error, results: [{ pointer, value }] } of path on the document text (key is
	// path + "\0" + text).
	const run = memo((key) => {
		const cut = key.indexOf("\u0000");
		const [path, text] = [key.slice(0, cut), key.slice(cut + 1)];
		const problem = pathProblem(path);
		if (problem) return { error: problem, results: [] };
		const doc = parseDoc(text);
		if (doc.error) return { error: `the document isn't usable: ${doc.error}`, results: [] };
		try {
			const found = JSONPath({ path, json: doc.value, resultType: "all", wrap: true }) ?? [];
			return { error: "", results: found.map((r) => ({ pointer: r.pointer, value: r.value })) };
		} catch (error) {
			return { error: error.message, results: [] };
		}
	}, 64);

	// The document as one row per node, depth first: { pointer, depth, key, text, type }.
	const nodesOf = memo((text) => {
		const doc = parseDoc(text);
		return doc.error === "" ? nodes(doc.value, { rootKey: "$", max: MAX_ROWS }) : [];
	}, 64);
	// The path the tree highlights in state (the root, or its draft in a handler).
	const focusedOf = (state) =>
		state.paths.items.find((x) => x.id === state.focus) ?? state.paths.items[0];
	// The focused path's results as one JSON object, pointer → value, for the results' view.
	const resultsTextOf = (state) => {
		const row = focusedOf(state);
		if (row === undefined) return "{}";
		const { results } = run(`${row.path}\u0000${state.docText}`);
		const out = {};
		for (const r of results.slice(0, MAX_RESULTS)) out[r.pointer || "(root)"] = r.value;
		return jsonText(out);
	};
	// After a handler: the results' view shows what next's focused path selects now.
	const refresh = (next) => {
		next.resultsView = apply(next.resultsView, "set_text", resultsTextOf(next));
	};
	// The document's text, in the root and in its editor.
	const setDoc = (next, text) => {
		next.docText = text;
		next.docView = apply(next.docView, "set_text", text);
	};
	const docEditor = (text) => ({
		id: "document",
		label: "Document JSON",
		text,
		mode: "tree",
		editable: true,
		on: "edit_document",
		rows: 8,
	});

	const PathRow = component({
		name: "PathRow",
		// expectCount: how many results the path should give; -1 when it doesn't say.
		fields: { id: t.string(), path: t.string(), expectCount: t.number() },
		queries: {
			get problem() {
				return pathProblem(this.path);
			},
			get hasProblem() {
				return this.problem !== "";
			},
		},
		view: div(
			{ class: "flex flex-col gap-1" },
			div(
				{ class: "join w-full" },
				button(
					{
						class: "btn btn-sm join-item font-mono",
						title: "Highlight this path's matches",
						"on:click": send("pick"),
					},
					field("id"),
				),
				input({
					class: "input input-sm input-bordered join-item flex-1 font-mono",
					"aria-label": "JSONPath",
					value: field("path"),
					"on:input": send("editPath", targetValue()),
				}),
			),
			$if(field("hasProblem"), p({ class: "text-xs text-error" }, field("problem")), ""),
		),
		on: {
			set_path: {
				pure: true,
				args: [t.string()],
				run(next, [path]) {
					next.path = path;
				},
			},
			set_expect_count: {
				pure: true,
				args: [t.number().int().min(-1)],
				run(next, [count]) {
					next.expectCount = count;
				},
			},
			editPath: {
				args: [t.string()],
				emits: { notify: ["set_path"] },
				run(_next, [path], ctx) {
					ctx.notify("set_path", [this.id, path]);
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

	// A new path with the next free id, no expected count.
	const newPath = (self, ctx, path) =>
		ctx.scope.make("PathRow", { id: nextId("p", self.paths.items), path, expectCount: -1 });
	// The paths' list handlers (kit.ui.listHandlers), refreshing the results after a change: a
	// move, add or remove may change which path is focused.
	const pathListHandlers = listHandlers("paths", {
		make: (self, ctx) => newPath(self, ctx, "$"),
		changed: (_self, next) => refresh(next),
	});

	const JsonPathLab = component({
		name: "JsonPathLab",
		fields: {
			paths: t.component("List"),
			docId: t.string(), // The document part's id; "" until there is one.
			docText: t.string(),
			focus: t.string(), // The path whose matches the tree highlights; "" for the first.
			docView: t.component("JsonView"), // The document's editor.
			resultsView: t.component("JsonView"), // The focused path's results.
		},
		methods: {
			pathById(id) {
				return this.paths.items.find((x) => x.id === id);
			},
			runOf(row) {
				return run(`${row.path}\u0000${this.docText}`);
			},
			// view tool: one path's results.

			toDomain() {
				return {
					paths: this.paths.items.map(({ id, path, expectCount }) => ({
						id,
						path,
						...(expectCount < 0 ? {} : { expectCount }),
					})),
					document: parseDoc(this.docText).value ?? null,
				};
			},
		},
		queries: {
			results(id) {
				const row = this.pathById(id);
				if (row === undefined) return { error: `no path ${id}` };
				const { error, results } = this.runOf(row);
				if (error) return { error };
				return {
					path: row.path,
					count: results.length,
					...(row.expectCount < 0 ? {} : { expected: row.expectCount }),
					results: results.slice(0, MAX_RESULTS),
				};
			},

			get docError() {
				return parseDoc(this.docText).error;
			},
			// Why there's no document (the editor says what's wrong with one that isn't JSON).
			get docHint() {
				return this.docText.trim() === "" ? this.docError : "";
			},
			get hasDocHint() {
				return this.docHint !== "";
			},
			// Per path: { id, path, count, expected, status, error }.
			get infos() {
				return this.paths.items.map((row) => {
					const { error, results } = this.runOf(row);
					const expected = row.expectCount < 0 ? null : row.expectCount;
					const status = error
						? "invalid"
						: expected === null
							? "none"
							: results.length === expected
								? "pass"
								: "fail";
					return { id: row.id, path: row.path, count: results.length, expected, status, error };
				});
			},
			// The info table's rows.
			get infoRows() {
				return this.infos.map((x) => ({
					id: x.id,
					label: x.error
						? x.error
						: `${x.count} results${x.expected === null ? "" : ` (expected ${x.expected})`}`,
					cls: expect.BADGE[x.status],
					status: x.status,
				}));
			},
			get counts() {
				const of = (s) => this.infos.filter((x) => x.status === s).length;
				return { pass: of("pass"), fail: of("fail"), none: of("none"), invalid: of("invalid") };
			},
			get headline() {
				const c = this.counts;
				return `${this.paths.items.length} paths · ${c.pass} pass · ${c.fail} fail · ${c.invalid} invalid`;
			},
			get focused() {
				return focusedOf(this);
			},
			get focusLabel() {
				return this.focused?.path ?? "no path";
			},
			// The focused path's results, for the list under the tree.
			get focusedResults() {
				const row = this.focused;
				if (row === undefined) return [];
				return this.runOf(row)
					.results.slice(0, MAX_RESULTS)
					.map((r) => ({ pointer: r.pointer || "(root)", value: preview(r.value) }));
			},
			// The document tree's rows, the focused path's matches highlighted.
			get treeRows() {
				const row = this.focused;
				const hit = new Set(row === undefined ? [] : this.runOf(row).results.map((r) => r.pointer));
				return nodesOf(this.docText).map((n) => ({
					key: n.key,
					text: n.text,
					style: indent(n.depth),
					cls: hit.has(n.pointer)
						? "flex gap-2 rounded bg-warning/40 outline outline-1 outline-warning"
						: "flex gap-2",
				}));
			},
			// view tool: the document's pointers and types, to learn its shape.
			get document_paths() {
				if (this.docError) return { error: this.docError };
				const rows = nodesOf(this.docText);
				return {
					nodes: rows.length,
					sample: rows.slice(0, MAX_RESULTS).map((n) => `${n.pointer || "(root)"}: ${n.type}`),
				};
			},
			get summary() {
				const c = this.counts;
				const paths = this.infos.map(
					(x) =>
						`  ${x.id}: ${x.path} → ${x.error ? `error: ${x.error}` : `${x.count} results`}${x.expected === null ? "" : `, expected ${x.expected} (${x.status})`}`,
				);
				const doc = this.docError
					? `document ${this.docId || "(none)"}: ${this.docError}`
					: `document ${this.docId || "(new)"}: ${clip(JSON.stringify(parseDoc(this.docText).value), 400)}`;
				return [
					`${this.paths.items.length} paths: ${c.pass} pass, ${c.fail} fail, ${c.none} have no expected count, ${c.invalid} invalid.`,
					"paths:",
					...paths,
					doc,
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("JSONPath lab"),
			section("Paths"),
			render(field("paths")),
			div(
				{ class: "flex flex-col gap-1" },
				each(
					field("infoRows"),
					div(
						{ class: "flex items-center gap-2 text-sm" },
						span({ class: "font-mono text-xs opacity-70" }, field("id")),
						span({ class: field("cls") }, field("status")),
						span(field("label")),
					),
				),
			),
			section(
				"Document, matches of ",
				span({ class: "font-mono normal-case" }, field("focusLabel")),
			),
			div(
				{ class: "rounded-box border border-base-300 p-2 font-mono text-sm" },
				each(
					field("treeRows"),
					div(
						{ style: field("style") },
						span(
							{ class: field("cls") },
							span({ class: "opacity-60" }, field("key")),
							field("text"),
						),
					),
				),
			),
			section("Results"),
			render(field("resultsView")),
			section("Document JSON"),
			render(field("docView")),
			$if(field("hasDocHint"), p({ class: "text-xs text-error" }, field("docHint")), ""),
		),
		on: {
			...pathListHandlers,
			set_path: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.pathById(id) !== undefined,
				run(next, [id, path]) {
					const i = this.paths.items.findIndex((x) => x.id === id);
					next.paths.items[i] = apply(next.paths.items[i], "set_path", path);
					refresh(next);
				},
			},
			add_path: {
				args: [t.string()],
				run(next, [path], ctx) {
					next.paths = apply(next.paths, "add_item", newPath(this, ctx, path));
					refresh(next);
				},
			},
			remove_path: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.pathById(id) !== undefined,
				run(next, [id]) {
					const i = this.paths.items.findIndex((x) => x.id === id);
					next.paths = apply(next.paths, "remove_item_at", i);
					refresh(next);
				},
			},
			set_expected_count: {
				pure: true,
				args: [t.string(), t.number().int().min(-1)],
				pre: (self, [id]) => self.pathById(id) !== undefined,
				run(next, [id, count]) {
					const i = this.paths.items.findIndex((x) => x.id === id);
					next.paths.items[i] = apply(next.paths.items[i], "set_expect_count", count);
				},
			},
			set_document: {
				pure: true,
				args: [t.any()],
				pre: (_self, [value]) => value !== undefined,
				run(next, [value]) {
					setDoc(next, pretty(value));
					refresh(next);
				},
			},
			set_document_text: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					setDoc(next, text);
					refresh(next);
				},
			},
			// From the document's editor: [its id, the text].
			edit_document: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [, text]) {
					setDoc(next, text);
					refresh(next);
				},
			},
			focus: {
				pure: true,
				args: [t.string()],
				run(next, [id]) {
					next.focus = id;
					refresh(next);
				},
			},
		},
	});

	// The expected count in m's meta, or -1.
	const countOf = (m) => {
		const v = expect.get(m, "count");
		return typeof v === "number" ? v : -1;
	};
	const countHeader = (n) => (n < 0 ? null : BigInt(n));

	// The root for msg: its path parts and its first json part (the query's bindings, or the
	// parts of those kinds when it decodes without them, as the empty sample does).
	const decode = (C, bindings, msg) => {
		const doc = (bindings.docs ?? kidsOf(msg, "json"))[0];
		const state = {
			paths: listOf(
				C,
				"paths",
				(bindings.paths ?? kidsOf(msg, "jsonpath")).map((m) =>
					C.PathRow({ id: m.id, path: strOf(m, "path"), expectCount: countOf(m) }),
				),
				{ addLabel: "Path" },
			),
			docId: doc?.id ?? "",
			docText: doc === undefined ? "" : pretty(dataJson(doc)),
			focus: "",
		};
		return C.JsonPathLab({
			...state,
			docView: C.JsonView(docEditor(state.docText)),
			resultsView: C.JsonView({ label: "Results", text: resultsTextOf(state), mode: "tree" }),
		});
	};

	// msg with root's paths (written losslessly by kit.lib.parts.encodeParts), then its document.
	const encode = (root, msg) => {
		const out = encodeParts(msg, {
			jsonpath: {
				items: root.paths.items,
				ordered: true,
				same: (m, x) => strOf(m, "path") === x.path && countOf(m) === x.expectCount,
				update: (m, x) => ({
					...withData(m, { path: x.path }),
					meta:
						countOf(m) === x.expectCount
							? m.meta
							: expect.withHeader(m.meta, expect.DIALECT, "count", countHeader(x.expectCount)),
				}),
				create: (x) =>
					message(
						x.id,
						"jsonpath",
						new Map([["path", x.path]]),
						expect.withHeader(new Map(), expect.DIALECT, "count", countHeader(x.expectCount)),
					),
			},
		});
		return withJsonPart(out, {
			kind: "json",
			id: root.docId,
			text: root.docText,
			newId: nextId("d", out.messages ?? []),
		});
	};

	// What a call view's state shows before its own: "running", the error, or "" once it answered.
	const failureOf = (view) => {
		const state = kit.ui.callState(view.result);
		return state === "running" || state === "failed" ? view.resultText || state : "";
	};
	const callView = (glimpse, open) =>
		kit.ui.toolCallFrame(glimpse, div({ class: "flex flex-col gap-0.5 font-mono text-xs" }, open));

	// How the chat shows a set_path or add_path call: the path and how many results it selects
	// now (its line in the summary the call answers with), opening to the other paths' lines.
	const PathCall = component({
		name: "PathCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			// The summary's path lines.
			get lines() {
				return failureOf(this) === ""
					? this.resultText.split("\n").filter((l) => l.startsWith("  "))
					: [];
			},
			// The line of the call's path: its id's, or the last one for a path just added.
			get line() {
				const id = this.call?.arguments?.id;
				const lines = this.lines;
				return (
					(id === undefined ? lines.at(-1) : lines.find((l) => l.startsWith(`  ${id}: `))) ?? ""
				);
			},
			get path() {
				const args = this.call?.arguments ?? {};
				const id = /^ {2}(\S+):/.exec(this.line)?.[1] ?? args.id ?? "?";
				return `${id} = ${args.path ?? "?"}`;
			},
			get state() {
				const at = this.line.indexOf(" → ");
				return failureOf(this) || (at < 0 ? "ok" : this.line.slice(at + 3));
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, / \(fail\)$|^error:/.test(this.state));
			},
			get others() {
				return this.lines.filter((l) => l !== this.line).map((text) => ({ text: text.trim() }));
			},
		}),
		view: callView("path", each(field("others"), p(field("text")))),
	});

	// How the chat shows a results call: the path and its count, opening to each result's
	// pointer and value.
	const ResultsCall = component({
		name: "ResultsCall",
		fields: { ...kit.ui.toolCallFields, kind: t.string("view") },
		queries: kit.ui.toolCallQueriesWith({
			get answer() {
				return failureOf(this) === "" ? (this.resultJson ?? {}) : {};
			},
			get path() {
				return `${this.call?.arguments?.id ?? "?"} = ${this.answer.path ?? "?"}`;
			},
			get state() {
				const a = this.answer;
				if (failureOf(this) !== "") return failureOf(this);
				if (a.error) return a.error;
				return `${a.count} results${a.expected === undefined ? "" : ` (expected ${a.expected})`}`;
			},
			get stateClass() {
				const a = this.answer;
				const bad = Boolean(a.error) || (a.expected !== undefined && a.expected !== a.count);
				return kit.ui.callStateClass(this.result, bad);
			},
			get rows() {
				return (this.answer.results ?? []).map((r) => ({
					text: `${r.pointer || "(root)"}: ${preview(r.value)}`,
				}));
			},
		}),
		view: callView("path", each(field("rows"), p(field("text")))),
	});

	return {
		components: { ...kit.ui.components, PathRow, JsonPathLab, PathCall, ResultsCall },
		root: "JsonPathLab",
		decode,
		encode,
		toolViews: { set_path: "PathCall", add_path: "PathCall", results: "ResultsCall" },
	};
}
