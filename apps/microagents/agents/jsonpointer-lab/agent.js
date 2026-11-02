// jsonpointer-lab: JSON Pointers (RFC 6901; "jsonpointer" parts, data {pointer}) resolved in
// one JSON document (a "json" part). For each pointer the page shows the value it reaches or
// why it reaches nothing, and the document as a tree: clicking a node puts its pointer in the
// focused pointer. The document is kept as JSON text, so the page can show a parse error while
// someone types. The root's handlers are the agent's tools; the rows' inputs notify the same
// handlers.
export default function define(kit) {
	const {
		apply,
		button,
		component,
		each,
		field,
		$if,
		render,
		send,
		sourceKey,
		t,
		tag,
		targetValue,
	} = kit.tutuca;
	const { dataJson, message } = kit.tdata;
	const { div, input, p, span } = tag;
	const { clip, indent, memo, nodes, parse, pointer, pretty, preview } = kit.lib.json;
	const { encodeParts, kidsOf, nextId, strOf, withData, withJsonPart } = kit.lib.parts;
	const { labHeader, listHandlers, listOf, section } = kit.ui;
	const MAX_ROWS = 1500;
	const MAX_FOUND = 50;

	// { value, error }: the document's text parsed. The value is shared: never mutate it.
	const parseDoc = (text) => parse(text, { emptyError: "there is no document yet" });
	// The document as one node per row, depth first: { pointer, depth, key, text, type, value }.
	const nodesOf = memo((text) => {
		const doc = parseDoc(text);
		return doc.error === ""
			? nodes(doc.value, { rootKey: "(root)", quoteKeys: true, max: MAX_ROWS })
			: [];
	}, 64);
	// The pointer clicks in the tree set in state (the root, or its draft in a handler).
	const focusedOf = (state) =>
		state.pointers.items.find((x) => x.id === state.focus) ?? state.pointers.items[0];
	// What the focused pointer reaches, as JSON text, or why it reaches nothing, for the value's
	// view.
	const valueTextOf = (state) => {
		const row = focusedOf(state);
		if (row === undefined) return "";
		const doc = parseDoc(state.docText);
		if (doc.error) return `the document isn't usable: ${doc.error}`;
		const r = pointer.resolve(doc.value, row.pointer);
		return r.resolves ? pretty(r.value) : r.reason;
	};
	// After a handler: the value's view shows what next's focused pointer reaches now.
	const refresh = (next) => {
		next.valueView = apply(next.valueView, "set_text", valueTextOf(next));
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

	const PointerRow = component({
		name: "PointerRow",
		fields: { id: t.string(), pointer: t.string() },
		view: div(
			{ class: "join w-full" },
			button(
				{
					class: "btn btn-sm join-item font-mono",
					title: "Focus: clicks in the tree set this pointer",
					"on:click": send("pick"),
				},
				field("id"),
			),
			input({
				class: "input input-sm input-bordered join-item flex-1 font-mono",
				"aria-label": "JSON Pointer",
				value: field("pointer"),
				"on:input": send("editPointer", targetValue()),
			}),
		),
		on: {
			set_pointer: {
				pure: true,
				args: [t.string()],
				run(next, [pointer]) {
					next.pointer = pointer;
				},
			},
			editPointer: {
				args: [t.string()],
				emits: { notify: ["set_pointer"] },
				run(_next, [pointer], ctx) {
					ctx.notify("set_pointer", [this.id, pointer]);
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

	// A new pointer with the next free id.
	const newPointer = (self, ctx, pointer) =>
		ctx.scope.make("PointerRow", { id: nextId("q", self.pointers.items), pointer });
	// The pointers' list handlers (kit.ui.listHandlers), refreshing the value after a change: a
	// move, add or remove may change which pointer is focused.
	const pointerListHandlers = listHandlers("pointers", {
		make: (self, ctx) => newPointer(self, ctx, ""),
		changed: (_self, next) => refresh(next),
	});

	const JsonPointerLab = component({
		name: "JsonPointerLab",
		fields: {
			pointers: t.component("List"),
			docId: t.string(), // The document part's id; "" until there is one.
			docText: t.string(),
			focus: t.string(), // The pointer a click in the tree sets; "" for the first.
			docView: t.component("JsonView"), // The document's editor.
			valueView: t.component("JsonView"), // What the focused pointer reaches.
		},
		methods: {
			pointerById(id) {
				return this.pointers.items.find((x) => x.id === id);
			},
			// view tool: where any pointer leads in the document.

			// view tool: the pointers of nodes whose key or value contains text (any case).

			toDomain() {
				return {
					pointers: this.pointers.items.map(({ id, pointer }) => ({ id, pointer })),
					document: parseDoc(this.docText).value ?? null,
				};
			},
		},
		queries: {
			resolve(p) {
				if (this.docError) return { error: `the document isn't usable: ${this.docError}` };
				const r = pointer.resolve(parseDoc(this.docText).value, p);
				return r.resolves
					? { pointer: p, tokens: r.tokens, resolves: true, value: r.value }
					: {
							pointer: p,
							tokens: r.tokens,
							resolves: false,
							segment: r.segment,
							reason: r.reason,
						};
			},
			find(text) {
				const needle = String(text).toLowerCase();
				const found = nodesOf(this.docText).filter(
					(n) =>
						n.key.toLowerCase().includes(needle) ||
						(n.type !== "object" &&
							n.type !== "array" &&
							String(n.value).toLowerCase().includes(needle)),
				);
				return {
					count: found.length,
					nodes: found.slice(0, MAX_FOUND).map((n) => ({ pointer: n.pointer, type: n.type })),
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
			// view tool: every pointer's resolution.
			get resolutions() {
				return this.pointers.items.map(({ id, pointer }) => ({ id, ...this.resolve(pointer) }));
			},
			// The resolutions as rows for the page.
			get resolutionRows() {
				return this.resolutions.map((r) => ({
					id: r.id,
					cls: r.resolves ? "badge badge-success" : "badge badge-error",
					status: r.resolves ? "resolves" : "no value",
					text: r.resolves ? preview(r.value) : (r.reason ?? r.error),
				}));
			},
			get counts() {
				const ok = this.resolutions.filter((r) => r.resolves).length;
				return { resolve: ok, fail: this.pointers.items.length - ok };
			},
			get headline() {
				const c = this.counts;
				return `${this.pointers.items.length} pointers · ${c.resolve} resolve · ${c.fail} don't`;
			},
			get focused() {
				return focusedOf(this);
			},
			get focusLabel() {
				const row = this.focused;
				return row === undefined ? "no pointer: a click adds one" : `${row.id} ${row.pointer}`;
			},
			// The document tree's rows, the focused pointer's node highlighted.
			get treeRows() {
				const target = this.focused?.pointer;
				return nodesOf(this.docText).map((n) => ({
					key: n.key,
					text: n.text,
					pointer: n.pointer || "(root)",
					style: indent(n.depth),
					cls:
						n.pointer === target
							? "btn btn-xs btn-warning h-auto justify-start font-mono font-normal normal-case"
							: "btn btn-xs btn-ghost h-auto justify-start font-mono font-normal normal-case",
				}));
			},
			get summary() {
				const c = this.counts;
				const lines = this.resolutions.map(
					(r) =>
						`  ${r.id}: ${JSON.stringify(r.pointer)} → ${r.resolves ? preview(r.value) : (r.reason ?? r.error)}`,
				);
				const doc = this.docError
					? `document ${this.docId || "(none)"}: ${this.docError}`
					: `document ${this.docId || "(new)"}: ${clip(JSON.stringify(parseDoc(this.docText).value), 400)}`;
				return [
					`${this.pointers.items.length} pointers: ${c.resolve} resolve, ${c.fail} don't.`,
					"pointers:",
					...lines,
					doc,
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("JSON Pointer lab"),
			section("Pointers"),
			render(field("pointers")),
			div(
				{ class: "flex flex-col gap-1" },
				each(
					field("resolutionRows"),
					div(
						{ class: "flex items-center gap-2 text-sm" },
						span({ class: "font-mono text-xs opacity-70" }, field("id")),
						span({ class: field("cls") }, field("status")),
						span({ class: "font-mono text-xs" }, field("text")),
					),
				),
			),
			section("Value at ", span({ class: "font-mono normal-case" }, field("focusLabel"))),
			render(field("valueView")),
			section(
				"Document · click a node to set ",
				span({ class: "font-mono normal-case" }, field("focusLabel")),
			),
			div(
				{ class: "flex flex-col rounded-box border border-base-300 p-2 text-sm" },
				each(
					field("treeRows"),
					div(
						{ style: field("style") },
						button(
							{
								class: field("cls"),
								title: field("pointer"),
								"on:click": send("pick_node", sourceKey()),
							},
							span({ class: "opacity-60" }, field("key")),
							span(field("text")),
						),
					),
				),
			),
			section("Document JSON"),
			render(field("docView")),
			$if(field("hasDocHint"), p({ class: "text-xs text-error" }, field("docHint")), ""),
		),
		on: {
			...pointerListHandlers,
			set_pointer: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.pointerById(id) !== undefined,
				run(next, [id, pointer]) {
					const i = this.pointers.items.findIndex((x) => x.id === id);
					next.pointers.items[i] = apply(next.pointers.items[i], "set_pointer", pointer);
					refresh(next);
				},
			},
			add_pointer: {
				args: [t.string()],
				run(next, [pointer], ctx) {
					next.pointers = apply(next.pointers, "add_item", newPointer(this, ctx, pointer));
					refresh(next);
				},
			},
			remove_pointer: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.pointerById(id) !== undefined,
				run(next, [id]) {
					const i = this.pointers.items.findIndex((x) => x.id === id);
					next.pointers = apply(next.pointers, "remove_item_at", i);
					refresh(next);
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
			// From the tree: node i's pointer goes in the focused pointer, or in a new one.
			pick_node: {
				args: [t.number().int().min(0)],
				run(next, [i], ctx) {
					const node = nodesOf(this.docText)[i];
					if (node === undefined) return;
					const row = this.focused;
					if (row === undefined) {
						next.pointers = apply(next.pointers, "add_item", newPointer(this, ctx, node.pointer));
					} else {
						const at = this.pointers.items.indexOf(row);
						next.pointers.items[at] = apply(next.pointers.items[at], "set_pointer", node.pointer);
					}
					refresh(next);
				},
			},
		},
	});

	// The root for msg: its pointer parts and its first json part (the query's bindings, or the
	// parts of those kinds when it decodes without them, as the empty sample does).
	const decode = (C, bindings, msg) => {
		const doc = (bindings.docs ?? kidsOf(msg, "json"))[0];
		const state = {
			pointers: listOf(
				C,
				"pointers",
				(bindings.pointers ?? kidsOf(msg, "jsonpointer")).map((m) =>
					C.PointerRow({ id: m.id, pointer: strOf(m, "pointer") }),
				),
				{ addLabel: "Pointer" },
			),
			docId: doc?.id ?? "",
			docText: doc === undefined ? "" : pretty(dataJson(doc)),
			focus: "",
		};
		return C.JsonPointerLab({
			...state,
			docView: C.JsonView(docEditor(state.docText)),
			valueView: C.JsonView({ label: "value", text: valueTextOf(state), mode: "tree" }),
		});
	};

	// msg with root's pointers (written losslessly by kit.lib.parts.encodeParts), then its
	// document.
	const encode = (root, msg) => {
		const out = encodeParts(msg, {
			jsonpointer: {
				items: root.pointers.items,
				ordered: true,
				same: (m, x) => strOf(m, "pointer") === x.pointer,
				update: (m, x) => withData(m, { pointer: x.pointer }),
				create: (x) => message(x.id, "jsonpointer", new Map([["pointer", x.pointer]])),
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
	const callView = (open) =>
		kit.ui.toolCallFrame(
			"pointer",
			div({ class: "flex flex-col gap-0.5 font-mono text-xs" }, open),
		);
	// Why a pointer reaches nothing starts so (resolve's reasons, or the document's error).
	const NO_VALUE = /^(segment \d|a pointer is|the document isn't usable)/;

	// How the chat shows a set_pointer or add_pointer call: the pointer and what it reaches now
	// or why it reaches nothing (its line in the summary the call answers with), opening to the
	// other pointers' lines.
	const PointerCall = component({
		name: "PointerCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			// The summary's pointer lines.
			get lines() {
				return failureOf(this) === ""
					? this.resultText.split("\n").filter((l) => l.startsWith("  "))
					: [];
			},
			// The line of the call's pointer: its id's, or the last one for a pointer just added.
			get line() {
				const id = this.call?.arguments?.id;
				const lines = this.lines;
				return (
					(id === undefined ? lines.at(-1) : lines.find((l) => l.startsWith(`  ${id}: `))) ?? ""
				);
			},
			get pointer() {
				const args = this.call?.arguments ?? {};
				const id = /^ {2}(\S+):/.exec(this.line)?.[1] ?? args.id ?? "?";
				return `${id} = ${JSON.stringify(args.pointer ?? "?")}`;
			},
			get reaches() {
				const at = this.line.indexOf(" → ");
				return at < 0 ? "" : this.line.slice(at + 3);
			},
			get resolves() {
				return this.reaches !== "" && !NO_VALUE.test(this.reaches);
			},
			get state() {
				return failureOf(this) || (this.resolves ? `→ ${this.reaches}` : this.reaches || "ok");
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, !this.resolves);
			},
			get others() {
				return this.lines.filter((l) => l !== this.line).map((text) => ({ text: text.trim() }));
			},
		}),
		view: callView(each(field("others"), p(field("text")))),
	});

	// How the chat shows a resolve call: the pointer and whether it resolves, opening to its
	// tokens and the value it reaches or why it reaches nothing.
	const ResolveCall = component({
		name: "ResolveCall",
		fields: { ...kit.ui.toolCallFields, kind: t.string("view") },
		queries: kit.ui.toolCallQueriesWith({
			get answer() {
				return failureOf(this) === "" ? (this.resultJson ?? {}) : {};
			},
			get pointer() {
				return JSON.stringify(this.call?.arguments?.pointer ?? "?");
			},
			get state() {
				const a = this.answer;
				return failureOf(this) || a.error || (a.resolves ? "resolves" : `segment ${a.segment}`);
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, !this.answer.resolves);
			},
			get rows() {
				const a = this.answer;
				if (a.tokens === undefined) return [];
				return [
					{ text: `tokens: ${JSON.stringify(a.tokens)}` },
					{ text: a.resolves ? `value: ${preview(a.value, 400)}` : a.reason },
				];
			},
		}),
		view: callView(each(field("rows"), p(field("text")))),
	});

	return {
		components: { ...kit.ui.components, PointerRow, JsonPointerLab, PointerCall, ResolveCall },
		root: "JsonPointerLab",
		decode,
		encode,
		toolViews: { set_pointer: "PointerCall", add_pointer: "PointerCall", resolve: "ResolveCall" },
	};
}
