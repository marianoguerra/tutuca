// regex-lab: regular expressions run against texts. Each text says, per regex, whether it
// should match (meta dialect https://tutuca.dev/d/expect, header <regex id>: "match" or
// "no-match"); the grid shows which expectations pass. The root's handlers are the agent's tools
// (set_regex, add_regex, …); the rows' inputs notify the same handlers, so edits from the page
// and from the model take one path.
export default function define(kit) {
	const { $if, apply, button, component, each, field, render, send, t, tag, targetValue } =
		kit.tutuca;
	const { message } = kit.tdata;
	const { div, input, p, span, textarea } = tag;
	const { expect } = kit.lib;
	const { encodeParts, kidsOf, nextId, strOf, withData } = kit.lib.parts;
	const { gridView, labHeader, listHandlers, listOf, section } = kit.ui;
	const { OUTCOMES } = expect;
	const MAX_MATCHES = 500;

	const compile = (pattern, flags) => {
		try {
			return { regex: new RegExp(pattern, flags), error: "" };
		} catch (error) {
			return { regex: null, error: error.message };
		}
	};
	// Every match of pattern in text: { index, end, text, groups } (at most MAX_MATCHES).
	const matchesOf = (pattern, flags, text) => {
		const { regex } = compile(pattern, flags.includes("g") ? flags : `${flags}g`);
		if (regex === null) return [];
		const out = [];
		for (const m of text.matchAll(regex)) {
			out.push({
				index: m.index,
				end: m.index + m[0].length,
				text: m[0],
				groups: [...m.slice(1)],
				named: { ...m.groups },
			});
			if (out.length >= MAX_MATCHES) break;
		}
		return out;
	};
	// text cut into { text, cls } pieces, the matches highlighted.
	const segmentsOf = (pattern, flags, text) => {
		const pieces = [];
		let at = 0;
		for (const m of matchesOf(pattern, flags, text)) {
			if (m.end === m.index) continue;
			if (m.index > at) pieces.push({ text: text.slice(at, m.index), cls: "" });
			pieces.push({ text: m.text, cls: "rounded bg-warning/40 outline outline-1 outline-warning" });
			at = m.end;
		}
		if (at < text.length) pieces.push({ text: text.slice(at), cls: "" });
		return pieces;
	};
	const RegexRow = component({
		name: "RegexRow",
		fields: { id: t.string(), pattern: t.string(), flags: t.string() },
		queries: {
			get error() {
				return compile(this.pattern, this.flags).error;
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
					{
						class: "btn btn-sm join-item font-mono",
						title: "Highlight this pattern",
						"on:click": send("pick"),
					},
					field("id"),
				),
				span({ class: "join-item flex items-center bg-base-200 px-2 font-mono" }, "/"),
				input({
					class: "input input-sm input-bordered join-item flex-1 font-mono",
					"aria-label": "Pattern",
					value: field("pattern"),
					"on:input": send("editPattern", targetValue()),
				}),
				span({ class: "join-item flex items-center bg-base-200 px-2 font-mono" }, "/"),
				input({
					class: "input input-sm input-bordered join-item w-20 font-mono",
					"aria-label": "Flags",
					value: field("flags"),
					"on:input": send("editFlags", targetValue()),
				}),
			),
			$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
		),
		on: {
			// The root changes a row through these: what it may do to one, the row's own fields.
			set_pattern: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [pattern, flags]) {
					next.pattern = pattern;
					next.flags = flags;
				},
			},
			editPattern: {
				args: [t.string()],
				emits: { notify: ["set_regex"] },
				run(_next, [pattern], ctx) {
					ctx.notify("set_regex", [this.id, pattern, this.flags]);
				},
			},
			editFlags: {
				args: [t.string()],
				emits: { notify: ["set_regex"] },
				run(_next, [flags], ctx) {
					ctx.notify("set_regex", [this.id, this.pattern, flags]);
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

	const TextCase = component({
		name: "TextCase",
		fields: { id: t.string(), text: t.string(), expect: t.map(t.enum(...OUTCOMES)) },
		view: textarea({
			class: "textarea textarea-bordered w-full font-mono text-sm",
			rows: 2,
			"aria-label": "Text",
			value: field("text"),
			"on:input": send("editText", targetValue()),
		}),
		on: {
			set_text: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					next.text = text;
				},
			},
			set_expectation: {
				pure: true,
				args: [t.string(), t.enum("match", "no-match", "none")],
				run(next, [regexId, outcome]) {
					if (outcome === "none") delete next.expect[regexId];
					else next.expect[regexId] = outcome;
				},
			},
			// none → match → no-match → none.
			cycle_expectation: {
				pure: true,
				args: [t.string()],
				run(next, [regexId]) {
					next.expect = expect.cycle(this.expect, regexId);
				},
			},
			editText: {
				args: [t.string()],
				emits: { notify: ["set_text"] },
				run(_next, [text], ctx) {
					ctx.notify("set_text", [this.id, text]);
				},
			},
		},
	});

	// Applies the pure message name(...args) to the text with id, if there is one.
	const toText = (self, next, id, name, ...args) => {
		const i = self.texts.items.findIndex((x) => x.id === id);
		if (i >= 0) next.texts.items[i] = apply(next.texts.items[i], name, ...args);
	};

	// A new regex or text, with the next free id.
	const newRegex = (self, ctx, pattern, flags) =>
		ctx.scope.make("RegexRow", { id: nextId("r", self.regexes.items), pattern, flags });
	const newText = (self, ctx, text) =>
		ctx.scope.make("TextCase", { id: nextId("t", self.texts.items), text, expect: {} });
	// After a regex is removed: the expectations that name it go too.
	const removed = (_self, next, regex) => {
		next.texts.items = next.texts.items.map((x) => apply(x, "set_expectation", regex.id, "none"));
	};

	const RegexLab = component({
		name: "RegexLab",
		fields: {
			regexes: t.component("List"),
			texts: t.component("List"),
			focus: t.string(), // The regex the texts highlight; "" for the first.
		},
		methods: {
			regexById(id) {
				return this.regexes.items.find((r) => r.id === id);
			},
			textById(id) {
				return this.texts.items.find((x) => x.id === id);
			},
			// One cell: { status: pass | fail | none | invalid, matched, expected }.
			cell(text, regex) {
				const { regex: re } = compile(regex.pattern, regex.flags.replace("g", "").replace("y", ""));
				const expected = text.expect[regex.id] ?? "none";
				const matched = re === null ? null : re.test(text.text);
				return { status: expect.status(expected, matched), matched, expected };
			},
			// view tool: where regex matches text, with capture groups.

			toDomain() {
				return {
					regexes: this.regexes.items.map(({ id, pattern, flags }) => ({ id, pattern, flags })),
					texts: this.texts.items.map(({ id, text, expect }) => ({
						id,
						text,
						expect: { ...expect },
					})),
				};
			},
		},
		queries: {
			explain_matches(regexId, textId) {
				const regex = this.regexById(regexId);
				const text = this.textById(textId);
				if (regex === undefined) return { error: `no regex ${regexId}` };
				if (text === undefined) return { error: `no text ${textId}` };
				const { error } = compile(regex.pattern, regex.flags);
				return error ? { error } : { matches: matchesOf(regex.pattern, regex.flags, text.text) };
			},

			get focused() {
				return this.regexById(this.focus) ?? this.regexes.items[0];
			},
			// Each text cut into pieces, the focused regex's matches highlighted.
			get highlights() {
				const r = this.focused;
				return this.texts.items.map((x) => ({
					id: x.id,
					segments:
						r === undefined ? [{ text: x.text, cls: "" }] : segmentsOf(r.pattern, r.flags, x.text),
				}));
			},
			get focusLabel() {
				const r = this.focused;
				return r === undefined ? "no pattern" : `/${r.pattern}/${r.flags}`;
			},
			// view tool: every text × regex.
			get grid() {
				return this.texts.items.map((text) => ({
					text: text.id,
					cells: this.regexes.items.map((regex) => ({
						regex: regex.id,
						...this.cell(text, regex),
					})),
				}));
			},
			// The grid as a status grid (kit.lib.grid): a header row of regex ids, then per text its
			// id and a cell per regex.
			get statusGrid() {
				return kit.lib.grid.grid({
					rows: this.texts.items,
					cols: this.regexes.items,
					cell: (text, regex) => {
						const c = this.cell(text, regex);
						return {
							status: c.status,
							label: c.matched === null ? "error" : c.matched ? "matches" : "no match",
							title: `expected: ${c.expected}; click to change`,
						};
					},
					rowLabel: (x) => x.id,
					colLabel: (r) => r.id,
					corner: "text",
				});
			},
			get statusGridCells() {
				return this.statusGrid.cells;
			},
			get statusGridStyle() {
				return this.statusGrid.gridStyle;
			},
			get counts() {
				const cells = this.grid.flatMap((row) => row.cells);
				const of = (s) => cells.filter((c) => c.status === s).length;
				return {
					pass: of("pass"),
					fail: of("fail"),
					unexpected: of("none"),
					invalid: of("invalid"),
				};
			},
			get summary() {
				const c = this.counts;
				const regexes = this.regexes.items.map(
					(r) =>
						`  ${r.id}: /${r.pattern}/${r.flags}${compile(r.pattern, r.flags).error ? ` (error: ${compile(r.pattern, r.flags).error})` : ""}`,
				);
				const texts = this.texts.items.map(
					(x) =>
						`  ${x.id}: ${JSON.stringify(x.text.length > 80 ? `${x.text.slice(0, 80)}…` : x.text)} expects ${JSON.stringify(x.expect)}`,
				);
				return [
					`${this.regexes.items.length} regexes, ${this.texts.items.length} texts: ${c.pass} expectations pass, ${c.fail} fail, ${c.unexpected} cells have no expectation, ${c.invalid} invalid.`,
					"regexes:",
					...regexes,
					"texts:",
					...texts,
				].join("\n");
			},
			get headline() {
				const c = this.counts;
				return `${c.pass} pass · ${c.fail} fail · ${c.unexpected} unset`;
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("Regex lab"),
			section("Patterns"),
			render(field("regexes")),
			section("Texts"),
			render(field("texts")),
			section("Matches of ", span({ class: "font-mono normal-case" }, field("focusLabel"))),
			each(
				field("highlights"),
				div(
					{ class: "flex gap-2 rounded-box border border-base-300 p-2" },
					span({ class: "font-mono text-xs opacity-60" }, field("id")),
					p(
						{ class: "whitespace-pre-wrap break-all font-mono text-sm" },
						each(field("segments"), span({ class: field("cls") }, field("text"))),
					),
				),
			),
			section("Expectations"),
			p(
				{ class: "text-xs opacity-60" },
				"Click a cell to cycle its expectation: none → match → no match.",
			),
			gridView("statusGrid", "cycle_cell"),
		),
		on: {
			...listHandlers("regexes", { make: (self, ctx) => newRegex(self, ctx, "", ""), removed }),
			...listHandlers("texts", { make: (self, ctx) => newText(self, ctx, "") }),
			set_regex: {
				pure: true,
				args: [t.string(), t.string(), t.string()],
				pre: (self, [id]) => self.regexById(id) !== undefined,
				run(next, [id, pattern, flags]) {
					const i = this.regexes.items.findIndex((r) => r.id === id);
					next.regexes.items[i] = apply(next.regexes.items[i], "set_pattern", pattern, flags);
				},
			},
			add_regex: {
				args: [t.string(), t.string()],
				run(next, [pattern, flags], ctx) {
					next.regexes = apply(next.regexes, "add_item", newRegex(this, ctx, pattern, flags));
				},
			},
			remove_regex: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.regexById(id) !== undefined,
				run(next, [id]) {
					const i = this.regexes.items.findIndex((r) => r.id === id);
					next.regexes = apply(next.regexes, "remove_item_at", i);
					removed(this, next, this.regexes.items[i]);
				},
			},
			add_text: {
				args: [t.string()],
				run(next, [text], ctx) {
					next.texts = apply(next.texts, "add_item", newText(this, ctx, text));
				},
			},
			set_text: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.textById(id) !== undefined,
				run(next, [id, text]) {
					toText(this, next, id, "set_text", text);
				},
			},
			remove_text: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.textById(id) !== undefined,
				run(next, [id]) {
					const i = this.texts.items.findIndex((x) => x.id === id);
					next.texts = apply(next.texts, "remove_item_at", i);
				},
			},
			set_expectation: {
				pure: true,
				args: [t.string(), t.string(), t.enum("match", "no-match", "none")],
				pre: (self, [textId, regexId]) =>
					self.textById(textId) !== undefined && self.regexById(regexId) !== undefined,
				run(next, [textId, regexId, outcome]) {
					toText(this, next, textId, "set_expectation", regexId, outcome);
				},
			},
			// From the grid: the cell at index i of its cells.
			cycle_cell: {
				pure: true,
				args: [t.number().int().min(0)],
				run(next, [i]) {
					const at = this.statusGrid.at(i);
					if (at === null) return;
					const { id } = this.texts.items[at.row];
					toText(this, next, id, "cycle_expectation", this.regexes.items[at.col].id);
				},
			},
			cycle_expectation: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [textId, regexId]) {
					toText(this, next, textId, "cycle_expectation", regexId);
				},
			},
			focus: {
				pure: true,
				args: [t.string()],
				run(next, [id]) {
					next.focus = id;
				},
			},
		},
	});

	const expectOf = (m) => expect.read(m, { accept: OUTCOMES });
	const textOf = (m) => (typeof m.data === "string" ? m.data : "");

	// The root for msg: its regex and text parts (the query's bindings, or the parts of that kind
	// when it decodes without them, as the empty sample does).
	const decode = (C, bindings, msg) =>
		C.RegexLab({
			regexes: listOf(
				C,
				"regexes",
				(bindings.regexes ?? kidsOf(msg, "regex")).map((m) =>
					C.RegexRow({ id: m.id, pattern: strOf(m, "pattern"), flags: strOf(m, "flags") }),
				),
				{ addLabel: "Pattern" },
			),
			texts: listOf(
				C,
				"texts",
				(bindings.texts ?? kidsOf(msg, "text")).map((m) =>
					C.TextCase({ id: m.id, text: textOf(m), expect: expectOf(m) }),
				),
				{ addLabel: "Text" },
			),
		});

	// msg with root's regexes and texts, written losslessly by kit.lib.parts.encodeParts. A
	// regex's flags are only written when there are some, or the part had them.
	const encode = (root, msg) =>
		encodeParts(msg, {
			regex: {
				items: root.regexes.items,
				ordered: true,
				same: (m, r) => strOf(m, "pattern") === r.pattern && strOf(m, "flags") === r.flags,
				update: (m, r) =>
					withData(m, {
						pattern: r.pattern,
						flags:
							r.flags !== "" || (m.data instanceof Map && m.data.has("flags")) ? r.flags : null,
					}),
				create: (r) =>
					message(
						r.id,
						"regex",
						new Map(
							r.flags === ""
								? [["pattern", r.pattern]]
								: [
										["pattern", r.pattern],
										["flags", r.flags],
									],
						),
					),
			},
			text: {
				items: root.texts.items,
				ordered: true,
				same: (m, x) => textOf(m) === x.text && expect.same(expectOf(m), x.expect),
				update: (m, x) => ({
					...m,
					data: textOf(m) === x.text ? m.data : x.text,
					meta: expect.same(expectOf(m), x.expect) ? m.meta : expect.withAll(m.meta, x.expect),
				}),
				create: (x) => message(x.id, "text", x.text, expect.metaFor(x.expect)),
			},
		});

	// How the chat shows a set_regex call: the pattern as /pattern/flags and what the grid it
	// answers with says, opening to the cells that fail. call and result are pi's toolCall block
	// and toolResult message (result is null while it runs); kind is the tool's kind.
	const SetRegexCall = component({
		name: "SetRegexCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get regex() {
				const { id = "?", pattern = "", flags = "" } = this.call?.arguments ?? {};
				return `${id} = /${pattern}/${flags}`;
			},
			get failing() {
				const rows = Array.isArray(this.resultJson) ? this.resultJson : [];
				return rows.flatMap((row) =>
					row.cells
						.filter((c) => c.status === "fail")
						.map((c) => ({ text: `${row.text} × ${c.regex}: expected ${c.expected}` })),
				);
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				const cells = (Array.isArray(this.resultJson) ? this.resultJson : []).flatMap(
					(row) => row.cells,
				);
				return kit.lib.expect.headline(cells.map((c) => c.status));
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, this.failing.length > 0);
			},
		}),
		view: kit.ui.toolCallFrame(
			"regex",
			each(field("failing"), p({ class: "font-mono text-xs text-error" }, field("text"))),
		),
	});

	return {
		components: { ...kit.ui.components, RegexRow, TextCase, RegexLab, SetRegexCall },
		root: "RegexLab",
		decode,
		encode,
		toolViews: { set_regex: "SetRegexCall" },
	};
}
