// glob-lab: glob patterns (picomatch, posix) matched against a list of paths. The paths part
// is one string with a path per line; the workspace shows them as a file tree, each file marked
// by whether the focused glob matches it. A glob can say, per path, whether it should match it
// (meta dialect https://tutuca.dev/d/expect on the glob part, header <path>: "match" or
// "no-match"), and explain shows the regex picomatch compiles the pattern to.
export default async function define(kit) {
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
	const { message } = kit.tdata;
	const { json, parts, expect } = kit.lib;
	const { labHeader, listHandlers, listOf, section } = kit.ui;
	const { div, input, label, p, span } = tag;
	const picomatch = (await kit.engines.picomatch()).default;

	// { test(path), error } for options (dot, nocase as 0/1) and a pattern, keyed together.
	const compile = json.memo((key) => {
		const opts = { dot: key[0] === "1", nocase: key[1] === "1" };
		try {
			return { test: picomatch(key.slice(2), opts), error: "" };
		} catch (e) {
			return { test: null, error: e.message };
		}
	}, 500);
	// { test(path), error } for a glob row; test is null when the pattern doesn't compile.
	const matcherOf = ({ pattern, dot, nocase }) =>
		compile(`${dot ? 1 : 0}${nocase ? 1 : 0}${pattern}`);
	const isMatch = (glob, path) => matcherOf(glob).test?.(path) ?? false;
	const pathsOf = (text) =>
		text
			.split("\n")
			.map((s) => s.trim())
			.filter((s) => s !== "");

	// The paths as tree rows, depth first in the order they first appear:
	// { path, name, depth, dir }. A directory's path ends in "/".
	const treeOf = (paths) => {
		const top = new Map();
		for (const path of paths) {
			const parts = path.split("/").filter((s) => s !== "");
			let level = top;
			for (const [i, name] of parts.entries()) {
				const last = i === parts.length - 1;
				const key = last ? name : `${name}/`;
				if (!level.has(key)) {
					const dirPath = `${parts.slice(0, i + 1).join("/")}/`;
					level.set(key, { path: last ? path : dirPath, kids: last ? null : new Map() });
				}
				if (!last) level = level.get(key).kids;
			}
		}
		const rows = [];
		const walk = (level, depth) => {
			for (const [name, n] of level) {
				rows.push({ path: n.path, name, depth, dir: n.kids !== null });
				if (n.kids !== null) walk(n.kids, depth + 1);
			}
		};
		walk(top, 0);
		return rows;
	};
	const GlobRow = component({
		name: "GlobRow",
		fields: {
			id: t.string(),
			pattern: t.string(),
			dot: t.boolean(),
			nocase: t.boolean(),
			expect: t.map(t.enum(...expect.OUTCOMES)),
		},
		queries: {
			get error() {
				return matcherOf(this).error;
			},
			get hasError() {
				return this.error !== "";
			},
		},
		view: div(
			{ class: "flex flex-col gap-1" },
			div(
				{ class: "join w-full items-center" },
				button(
					{
						class: "btn btn-sm join-item font-mono",
						title: "Show in the tree",
						"on:click": send("pick"),
					},
					field("id"),
				),
				input({
					class: "input input-sm input-bordered join-item flex-1 font-mono",
					"aria-label": "Glob",
					value: field("pattern"),
					"on:input": send("editPattern", targetValue()),
				}),
				label(
					{ class: "join-item flex items-center gap-1 bg-base-200 px-2 text-xs" },
					input({
						type: "checkbox",
						class: "checkbox checkbox-xs",
						checked: field("dot"),
						"on:change": send("toggleDot"),
					}),
					"dot",
				),
				label(
					{ class: "join-item flex items-center gap-1 bg-base-200 px-2 text-xs" },
					input({
						type: "checkbox",
						class: "checkbox checkbox-xs",
						checked: field("nocase"),
						"on:change": send("toggleNocase"),
					}),
					"nocase",
				),
			),
			$if(field("hasError"), p({ class: "text-xs text-error" }, field("error")), ""),
		),
		on: {
			// What the root changes.
			set_pattern: {
				pure: true,
				args: [t.string()],
				run(next, [pattern]) {
					next.pattern = pattern;
				},
			},
			set_options: {
				pure: true,
				args: [t.boolean(), t.boolean()],
				run(next, [dot, nocase]) {
					next.dot = dot;
					next.nocase = nocase;
				},
			},
			set_expect: {
				pure: true,
				args: [t.map(t.enum(...expect.OUTCOMES))],
				run(next, [expected]) {
					next.expect = expected;
				},
			},
			editPattern: {
				args: [t.string()],
				emits: { notify: ["set_glob"] },
				run(_next, [pattern], ctx) {
					ctx.notify("set_glob", [this.id, pattern]);
				},
			},
			toggleDot: {
				args: [],
				emits: { notify: ["set_glob_options"] },
				run(_next, _args, ctx) {
					ctx.notify("set_glob_options", [this.id, !this.dot, this.nocase]);
				},
			},
			toggleNocase: {
				args: [],
				emits: { notify: ["set_glob_options"] },
				run(_next, _args, ctx) {
					ctx.notify("set_glob_options", [this.id, this.dot, !this.nocase]);
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

	const MARK = {
		pass: "badge badge-success badge-xs",
		fail: "badge badge-error badge-xs",
		none: "hidden",
	};
	// next with message name(...args) applied to the glob with id.
	const toGlob = (self, next, id, name, ...args) => {
		const i = self.globs.items.findIndex((x) => x.id === id);
		next.globs.items[i] = apply(next.globs.items[i], name, ...args);
	};
	const setOutcome = (self, next, globId, path, outcome) => {
		const out = { ...self.globById(globId).expect };
		if (outcome === "none") delete out[path];
		else out[path] = outcome;
		toGlob(self, next, globId, "set_expect", out);
	};

	// A new glob with the next free id, no options and no expectations.
	const newGlob = (self, ctx, pattern) =>
		ctx.scope.make("GlobRow", {
			id: parts.nextId("g", self.globs.items),
			pattern,
			dot: false,
			nocase: false,
			expect: {},
		});

	const GlobLab = component({
		name: "GlobLab",
		fields: {
			globs: t.component("List"),
			paths: t.string(), // One path per line.
			pathsView: t.component("JsonView"), // The paths' editor (plain text).
			focus: t.string(), // The glob the tree shows; "" for the first.
		},
		methods: {
			globById(id) {
				return this.globs.items.find((g) => g.id === id);
			},
			// What glob does on every path: matched, unmatched and each expectation's status.
			report(glob) {
				const paths = this.pathList;
				const matched = paths.filter((x) => isMatch(glob, x));
				const set = new Set(matched);
				const expectations = Object.entries(glob.expect).map(([path, expected]) => {
					const is = isMatch(glob, path);
					return { path, expected, matched: is, status: expect.status(expected, is) };
				});
				return {
					matched,
					unmatched: paths.filter((x) => !set.has(x)),
					expectations,
					pass: expectations.filter((e) => e.status === "pass").length,
					fail: expectations.filter((e) => e.status === "fail").length,
				};
			},
			// view tool: which paths a glob matches and how its expectations fare.

			// view tool: the regex picomatch compiles a glob to, and how it splits it.

			toDomain() {
				return {
					globs: this.globs.items.map(({ id, pattern, dot, nocase, expect }) => ({
						id,
						pattern,
						dot,
						nocase,
						expect: { ...expect },
					})),
					paths: this.pathList,
				};
			},
		},
		queries: {
			matches(globId) {
				const g = this.globById(globId);
				if (g === undefined) return { error: `no glob ${globId}` };
				if (g.error) return { error: g.error };
				return { pattern: g.pattern, dot: g.dot, nocase: g.nocase, ...this.report(g) };
			},
			explain(globId) {
				const g = this.globById(globId);
				if (g === undefined) return { error: `no glob ${globId}` };
				if (g.error) return { error: g.error };
				const opts = { dot: g.dot, nocase: g.nocase };
				const re = picomatch.makeRe(g.pattern, opts);
				const scan = picomatch.scan(g.pattern, opts);
				return {
					pattern: g.pattern,
					regex: re.source,
					flags: re.flags,
					base: scan.base,
					glob: scan.glob,
					isGlob: scan.isGlob,
					negated: scan.negated,
				};
			},

			get pathList() {
				return pathsOf(this.paths);
			},
			get focused() {
				return this.globById(this.focus) ?? this.globs.items[0];
			},
			get focusLabel() {
				const g = this.focused;
				return g === undefined ? "no glob" : `${g.id}: ${g.pattern}`;
			},
			// The tree of paths, marked by the focused glob.
			get tree() {
				const g = this.focused;
				const rows = treeOf(this.pathList);
				return rows.map((r) => {
					const style = json.indent(r.depth);
					if (r.dir) {
						const under = this.pathList.filter((x) => x.startsWith(r.path));
						const n = g === undefined ? 0 : under.filter((x) => isMatch(g, x)).length;
						return {
							...r,
							style,
							cls: "font-semibold opacity-70",
							note: `${n}/${under.length}`,
							mark: "none",
							title: "",
						};
					}
					const is = g !== undefined && isMatch(g, r.path);
					const expected = g?.expect[r.path] ?? "none";
					return {
						...r,
						style,
						cls: is ? "text-success" : "opacity-50",
						note: is ? "✓" : "",
						mark: MARK[expect.status(expected, is)],
						title: `expected: ${expected}; click to change`,
					};
				});
			},
			get headline() {
				const reports = this.globs.items.map((g) => this.report(g));
				const pass = reports.reduce((n, r) => n + r.pass, 0);
				const fail = reports.reduce((n, r) => n + r.fail, 0);
				const g = this.focused;
				const n = g === undefined ? 0 : this.report(g).matched.length;
				return `${n}/${this.pathList.length} matched · ${pass} pass · ${fail} fail`;
			},
			get summary() {
				const globs = this.globs.items.map((g) => {
					const r = this.report(g);
					const opts = [g.dot ? "dot" : "", g.nocase ? "nocase" : ""].filter(Boolean).join(", ");
					const err = g.error ? ` (error: ${g.error})` : "";
					return `  ${g.id}: ${g.pattern}${opts ? ` [${opts}]` : ""}${err} matches ${r.matched.length}/${this.pathList.length}; expectations ${r.pass} pass, ${r.fail} fail`;
				});
				const paths = this.pathList;
				return [
					`${this.globs.items.length} globs, ${paths.length} paths.`,
					"globs:",
					...globs,
					"paths:",
					...paths.slice(0, 200).map((x) => `  ${x}`),
					...(paths.length > 200 ? [`  … and ${paths.length - 200} more`] : []),
				].join("\n");
			},
		},
		view: div(
			{ class: "flex flex-col gap-4" },
			labHeader("Glob lab"),
			section("Globs"),
			render(field("globs")),
			div(
				{ class: "grid gap-4 md:grid-cols-2" },
				render(field("pathsView")),
				div(
					{ class: "flex flex-col gap-1" },
					section("Tree for ", span({ class: "font-mono normal-case" }, field("focusLabel"))),
					p(
						{ class: "text-xs opacity-60" },
						"Click a file to cycle its expectation: none → match → no match.",
					),
					each(
						field("tree"),
						button(
							{
								class: "flex items-center gap-2 text-left font-mono text-xs hover:bg-base-200",
								style: field("style"),
								title: field("title"),
								disabled: field("dir"),
								"on:click": send("cycle_path", sourceKey()),
							},
							span({ class: field("cls") }, field("name")),
							span({ class: "opacity-60" }, field("note")),
							span({ class: field("mark") }, ""),
						),
					),
				),
			),
		),
		on: {
			...listHandlers("globs", { make: (self, ctx) => newGlob(self, ctx, "**/*") }),
			set_glob: {
				pure: true,
				args: [t.string(), t.string()],
				pre: (self, [id]) => self.globById(id) !== undefined,
				run(next, [id, pattern]) {
					toGlob(this, next, id, "set_pattern", pattern);
				},
			},
			set_glob_options: {
				pure: true,
				args: [t.string(), t.boolean(), t.boolean()],
				pre: (self, [id]) => self.globById(id) !== undefined,
				run(next, [id, dot, nocase]) {
					toGlob(this, next, id, "set_options", dot, nocase);
				},
			},
			add_glob: {
				args: [t.string()],
				run(next, [pattern], ctx) {
					next.globs = apply(next.globs, "add_item", newGlob(this, ctx, pattern));
				},
			},
			remove_glob: {
				pure: true,
				args: [t.string()],
				pre: (self, [id]) => self.globById(id) !== undefined,
				run(next, [id]) {
					const i = this.globs.items.findIndex((g) => g.id === id);
					next.globs = apply(next.globs, "remove_item_at", i);
				},
			},
			set_paths: {
				pure: true,
				args: [t.string()],
				run(next, [text]) {
					next.paths = text;
					next.pathsView = apply(next.pathsView, "set_text", text);
				},
			},
			// The paths' editor notifies [id, text] on every edit (its own text is already so).
			edit_paths: {
				pure: true,
				args: [t.string(), t.string()],
				run(next, [, text]) {
					next.paths = text;
				},
			},
			set_expectation: {
				pure: true,
				args: [t.string(), t.string(), t.enum("match", "no-match", "none")],
				pre: (self, [id]) => self.globById(id) !== undefined,
				run(next, [globId, path, outcome]) {
					setOutcome(this, next, globId, path, outcome);
				},
			},
			// From the tree: the file at row i cycles the focused glob's expectation for it.
			cycle_path: {
				pure: true,
				args: [t.number().int().min(0)],
				run(next, [i]) {
					const g = this.focused;
					const row = treeOf(this.pathList)[i];
					if (g === undefined || row === undefined || row.dir) return;
					toGlob(this, next, g.id, "set_expect", expect.cycle(g.expect, row.path));
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

	// How the chat shows a set_glob call: the pattern as id = pattern, and how many paths it
	// matches with how its expectations fare, read from the summary it answers with.
	const SetGlobCall = component({
		name: "SetGlobCall",
		fields: { ...kit.ui.toolCallFields },
		queries: kit.ui.toolCallQueriesWith({
			get glob() {
				const { id = "?", pattern = "" } = this.call?.arguments ?? {};
				return `${id} = ${pattern}`;
			},
			// The glob's line of the summary: "  g1: src/** matches 3/12; expectations 3 pass, 0 fail".
			get line() {
				const head = `  ${this.call?.arguments?.id}: `;
				return (
					this.resultText
						.split("\n")
						.find((l) => l.startsWith(head))
						?.trim() ?? ""
				);
			},
			get counts() {
				const m = / matches (\d+)\/(\d+); expectations (\d+) pass, (\d+) fail$/.exec(this.line);
				return m === null ? null : m.slice(1).map(Number);
			},
			get error() {
				return /\(error: (.*)\) matches /.exec(this.line)?.[1] ?? "";
			},
			get state() {
				if (this.result === null || this.result === undefined) return "running";
				if (this.result.isError) return this.resultText || "failed";
				if (this.error) return "doesn't compile";
				if (this.counts === null) return "ok";
				const [n, of, pass, fail] = this.counts;
				return `matches ${n}/${of} · ${pass} pass · ${fail} fail`;
			},
			get stateClass() {
				return kit.ui.callStateClass(this.result, this.error !== "" || (this.counts?.[3] ?? 0) > 0);
			},
		}),
		view: kit.ui.toolCallFrame("glob", p({ class: "break-all font-mono text-xs" }, field("line"))),
	});

	const globData = (m) => {
		const d = m.data instanceof Map ? m.data : new Map();
		return {
			pattern: parts.strOf(m, "pattern"),
			dot: d.get("dot") === true,
			nocase: d.get("nocase") === true,
		};
	};
	const expectOf = (m) => expect.read(m, { accept: expect.OUTCOMES });
	const textOf = (m) => (typeof m?.data === "string" ? m.data : "");

	// The root for msg: its glob parts and its first paths part (the query's bindings, or the
	// parts of that kind when it decodes without them, as the empty sample does).
	const decode = (C, bindings, msg) => {
		const paths = textOf((bindings.paths ?? parts.kidsOf(msg, "paths"))[0]);
		return C.GlobLab({
			globs: listOf(
				C,
				"globs",
				(bindings.globs ?? parts.kidsOf(msg, "glob")).map((m) =>
					C.GlobRow({ id: m.id, ...globData(m), expect: expectOf(m) }),
				),
				{ addLabel: "Glob" },
			),
			paths,
			pathsView: C.JsonView(
				kit.ui.jsonViewArgs(paths, {
					label: "Paths, one per line",
					id: "paths",
					json: false,
					editable: true,
					on: "edit_paths",
					rows: 14,
				}),
			),
		});
	};

	const newGlobData = (g, old) => {
		const data = new Map(old ?? []);
		data.set("pattern", g.pattern);
		for (const k of ["dot", "nocase"]) {
			if (g[k] || data.has(k)) data.set(k, g[k]);
		}
		return data;
	};
	const sameData = (m, g) => {
		const old = globData(m);
		return old.pattern === g.pattern && old.dot === g.dot && old.nocase === g.nocase;
	};

	// msg with root's globs and paths: unchanged parts stay the same objects, removed globs go,
	// new ones are added at the end; only the first paths part is the root's, others stay.
	const encode = (root, msg) => {
		const out = parts.encodeParts(msg, {
			glob: {
				items: root.globs.items,
				ordered: true,
				same: (m, g) => sameData(m, g) && expect.same(expectOf(m), g.expect),
				update: (m, g) => ({
					...m,
					data: sameData(m, g) ? m.data : newGlobData(g, m.data instanceof Map ? m.data : null),
					meta: expect.same(expectOf(m), g.expect) ? m.meta : expect.withAll(m.meta, g.expect),
				}),
				create: (g) => message(g.id, "glob", newGlobData(g, null), expect.metaFor(g.expect)),
			},
		});
		const kids = out.messages ?? [];
		const i = kids.findIndex((m) => m.kind === "paths");
		if (i < 0)
			return root.paths === ""
				? out
				: parts.withKids(out, [...kids, message("paths", "paths", root.paths)]);
		if (textOf(kids[i]) === root.paths) return out;
		return parts.withKids(out, kids.with(i, { ...kids[i], data: root.paths }));
	};

	return {
		components: { ...kit.ui.components, GlobRow, GlobLab, SetGlobCall },
		root: "GlobLab",
		decode,
		encode,
		toolViews: { set_glob: "SetGlobCall" },
	};
}
