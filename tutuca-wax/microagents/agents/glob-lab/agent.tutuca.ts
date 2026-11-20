// glob-lab: glob patterns (picomatch, posix) matched against a list of paths. The paths are one
// string with a path per line; the workspace shows them as a file tree, each file marked by
// whether the focused glob matches it. A glob can say, per path, whether it should match it
// ("match" or "no-match"), and explain shows the regex picomatch compiles it to. The globs run in
// the page (microagents/glob, microagents/engines/glob.js). The root's messages are the agent's
// tools; the rows' inputs send messages of their own, by the row's key.
import type { MicroAgent } from "../../kit/kit.tutuca";
import {
	button,
	div,
	each,
	field,
	h2,
	h3,
	header,
	input,
	label,
	lookupBind,
	p,
	send,
	sourceKey,
	span,
	targetValue,
	textarea,
	when,
} from "tutuca/view";
import { range, without } from "tutuca/data";
import { errorOf, explain, pathsOf, test, tree } from "microagents/glob";

/** A glob, with the id the model names it by (g1, g2, …), its options (dot: wildcards match
 * dotfiles; nocase), and per path whether it should match ("match" or "no-match"). */
export type Glob = { id: string; pattern: string; dot: boolean; nocase: boolean; expect: { [key: string]: string } };
export type Outcome = "match" | "no-match" | "none";
/** A row of the tree: kind is dir, hit or miss; mark is pass, fail or none. */
export type TreeRow = { path: string; name: string; style: string; kind: string; note: string; mark: string; title: string };
export type Expectation = { path: string; expected: string; matched: boolean; status: string };

/** What g expects of path: "match", "no-match" or "none". */
function expected(g: Readonly<Glob>, path: string): string {
	return g.expect[path] ?? "none";
}

/** pass, fail or none for an expectation and whether the glob matched. */
function statusOf(outcome: string, matched: boolean): string {
	if (outcome === "none") return "none";
	return (outcome === "match") === matched ? "pass" : "fail";
}

/** none → match → no-match → none. */
function cycled(outcome: string): Outcome {
	if (outcome === "none") return "match";
	if (outcome === "match") return "no-match";
	return "none";
}

/** Whether g matches path. */
function matchesPath(g: Readonly<Glob>, path: string): boolean {
	return test(g.pattern, g.dot, g.nocase, path);
}

/** g's expectations, each with whether it matched and pass or fail. */
function expectationsOf(g: Readonly<Glob>): Expectation[] {
	const out: Expectation[] = [];
	for (const path of Object.keys(g.expect)) {
		const want = expected(g, path);
		const matched = matchesPath(g, path);
		out.push({ path, expected: want, matched, status: statusOf(want, matched) });
	}
	return out;
}

/** How many of paths g matches. */
function matchedCount(g: Readonly<Glob>, paths: readonly string[]): number {
	let n = 0;
	for (const path of paths) if (matchesPath(g, path)) n += 1;
	return n;
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

export type GlobLab = {
	/** The globs, each with an id the model names it by (g1, g2, …), its options (dot: wildcards
	 * match dotfiles; nocase), and per path whether it should match ("match" or "no-match"). */
	globs: Glob[];
	/** The paths: one string, one path per line. */
	paths: string;
	/** The glob the tree shows; "" for the first. */
	focus: string;
	readonly summary: string;
	readonly domain: unknown;
	readonly data: unknown;
	readonly headline: string;
	readonly focusLabel: string;
	/** The globs as rows, with why each doesn't compile ("" when it does). */
	readonly globRows: { id: string; pattern: string; dot: boolean; nocase: boolean; error: string }[];
	/** The paths as a file tree, each file marked by the focused glob: kind is dir, hit or miss;
	 * mark is pass, fail or none. */
	readonly tree: TreeRow[];
	/** The glob the tree shows: focus's, or the first. */
	readonly focused: Glob;
};

export const GlobLab = {
	implements: ["MicroAgent"],
	meta: {
		// The tree's classes, which its loop's enrich computes.
		"https://tutuca.dev/meta/classes": {
			classes: "font-semibold opacity-70 text-success opacity-50 badge badge-success badge-error badge-xs hidden",
		},
	},
	defaults: { paths: "", focus: "" },
	constraints: { globs: { minLength: 1 } },
	queries: {
		get focused(): Glob {
			const at = this.globs.findIndex((g) => g.id === this.focus);
			return this.globs[at < 0 ? 0 : at] ?? { id: "", pattern: "", dot: false, nocase: false, expect: {} };
		},
		get globRows() {
			return this.globs.map((g) => ({ id: g.id, pattern: g.pattern, dot: g.dot, nocase: g.nocase, error: errorOf(g.pattern, g.dot, g.nocase) }));
		},
		get tree(): TreeRow[] {
			const g = this.focused;
			const out: TreeRow[] = [];
			for (const r of tree(this.paths, g.pattern, g.dot, g.nocase)) {
				const style = `padding-left: ${r.depth}rem`;
				if (r.dir) {
					out.push({ path: r.path, name: r.name, style, kind: "dir", note: r.note, mark: "none", title: "" });
				} else {
					const want = expected(g, r.path);
					out.push({
						path: r.path,
						name: r.name,
						style,
						kind: r.matched ? "hit" : "miss",
						note: r.note,
						mark: statusOf(want, r.matched),
						title: `expected: ${want}; click to change`,
					});
				}
			}
			return out;
		},
		get focusLabel(): string {
			const g = this.focused;
			return `${g.id}: ${g.pattern}`;
		},
		get headline(): string {
			const paths = pathsOf(this.paths);
			let pass = 0;
			let fail = 0;
			for (const g of this.globs) {
				for (const e of expectationsOf(g)) {
					if (e.status === "pass") pass += 1;
					if (e.status === "fail") fail += 1;
				}
			}
			return `${matchedCount(this.focused, paths)}/${paths.length} matched · ${pass} pass · ${fail} fail`;
		},
		get summary(): string {
			const paths = pathsOf(this.paths);
			const total = paths.length;
			const lines = [`${this.globs.length} globs, ${total} paths.`, "globs:"];
			for (const g of this.globs) {
				let line = `  ${g.id}: ${g.pattern}`;
				if (g.dot && g.nocase) line = `${line} [dot, nocase]`;
				if (g.dot && !g.nocase) line = `${line} [dot]`;
				if (!g.dot && g.nocase) line = `${line} [nocase]`;
				const why = errorOf(g.pattern, g.dot, g.nocase);
				if (why !== "") line = `${line} (error: ${why})`;
				const es = expectationsOf(g);
				const pass = es.filter((e) => e.status === "pass").length;
				const fail = es.filter((e) => e.status === "fail").length;
				lines.push(`${line} matches ${matchedCount(g, paths)}/${total}; expectations ${pass} pass, ${fail} fail`);
			}
			lines.push("paths:");
			for (const path of paths.slice(0, 200)) lines.push(`  ${path}`);
			if (total > 200) lines.push(`  … and ${total - 200} more`);
			return lines.join("\n");
		},
		/** The JSON it opened, changed: { globs, paths }. */
		get data(): unknown {
			return { globs: this.globs, paths: this.paths };
		},
		/** The globs and the paths as a list. */
		get domain(): unknown {
			return { globs: this.globs, paths: pathsOf(this.paths) };
		},
		/** The paths a glob matches and doesn't, and each of its expectations with pass or fail. */
		matches(glob: string): unknown {
			const g = this.globs.find((x) => x.id === glob);
			if (g === undefined) return { error: `no glob ${glob}` };
			const why = errorOf(g.pattern, g.dot, g.nocase);
			if (why !== "") return { error: why };
			const matched: string[] = [];
			const unmatched: string[] = [];
			for (const path of pathsOf(this.paths)) {
				if (matchesPath(g, path)) matched.push(path);
				else unmatched.push(path);
			}
			const es = expectationsOf(g);
			return {
				pattern: g.pattern,
				dot: g.dot,
				nocase: g.nocase,
				matched,
				unmatched,
				expectations: es,
				pass: es.filter((e) => e.status === "pass").length,
				fail: es.filter((e) => e.status === "fail").length,
			};
		},
		/** The regex picomatch compiles a glob to, with its base directory and whether it is a glob at
		 * all. */
		explain(glob: string): unknown {
			const g = this.globs.find((x) => x.id === glob);
			if (g === undefined) return { error: `no glob ${glob}` };
			const why = errorOf(g.pattern, g.dot, g.nocase);
			if (why !== "") return { error: why };
			const got = explain(g.pattern, g.dot, g.nocase);
			if (got === null) return { error: "error" };
			return {
				regex: got.regex,
				flags: got.flags,
				base: got.base,
				glob: got.glob,
				isGlob: got.isGlob,
				negated: got.negated,
				pattern: g.pattern,
			};
		},
	},
	on: {
		/** Change a glob's pattern. */
		setGlob: {
			pure: true,
			changes: ["globs"],
			pre(prev, [id, pattern]: [string, string]) {
				return this.globs.some((g) => g.id === id);
			},
			run(next, [id, pattern]: [string, string]) {
				const item = next.globs[this.globs.findIndex((g) => g.id === id)];
				if (item !== undefined) item.pattern = pattern;
			},
		},
		/** Set a glob's options: dot (wildcards match dotfiles) and nocase. */
		setGlobOptions: {
			pure: true,
			changes: ["globs"],
			pre(prev, [id, dot, nocase]: [string, boolean, boolean]) {
				return this.globs.some((g) => g.id === id);
			},
			run(next, [id, dot, nocase]: [string, boolean, boolean]) {
				const item = next.globs[this.globs.findIndex((g) => g.id === id)];
				if (item === undefined) return;
				item.dot = dot;
				item.nocase = nocase;
			},
		},
		/** Add a glob; it gets the next free id (g1, g2, …). */
		addGlob: {
			pure: true,
			changes: ["globs"],
			post(prev, next, [pattern]: [string]) {
				return next.globs.length === prev.globs.length + 1;
			},
			run(next, [pattern]: [string]) {
				const id = nextId(
					this.globs.map((g) => g.id),
					"g",
				);
				next.globs.push({ id, pattern, dot: false, nocase: false, expect: {} });
			},
		},
		/** Remove a glob. pre is only checked in dev mode: the last glob stays, since every query reads
		 * the focused one. */
		removeGlob: {
			pure: true,
			changes: ["globs", "focus"],
			pre(prev, [id]: [string]) {
				return this.globs.some((g) => g.id === id) && this.globs.length > 1;
			},
			post(prev, next, [id]: [string]) {
				return next.globs.length === prev.globs.length - 1;
			},
			run(next, [id]: [string]) {
				const i = this.globs.findIndex((g) => g.id === id);
				if (i < 0 || this.globs.length <= 1) return;
				next.globs.splice(i, 1);
				if (this.focus === id) next.focus = "";
			},
		},
		/** Move a glob to a position (0 is first). */
		reorderGlobs: {
			pure: true,
			changes: ["globs"],
			constraints: { index: { int: true, min: 0 } },
			pre(prev, [id, index]: [string, number]) {
				return this.globs.some((g) => g.id === id);
			},
			post(prev, next, [id, index]: [string, number]) {
				return next.globs.length === prev.globs.length;
			},
			run(next, [id, index]: [string, number]) {
				const i = this.globs.findIndex((g) => g.id === id);
				if (i < 0) return;
				const order = movedOrder(this.globs.length, i, index);
				next.globs = order.map((j) => this.globs[j] ?? { id: "", pattern: "", dot: false, nocase: false, expect: {} });
			},
		},
		/** Replace the paths: one string, one path per line. */
		setPaths: {
			pure: true,
			changes: ["paths"],
			post(prev, next, [text]: [string]) {
				return next.paths === text;
			},
			run(next, [text]: [string]) {
				next.paths = text;
			},
		},
		/** Say whether a glob should match a path: match, no-match, or none to clear it. */
		setExpectation: {
			pure: true,
			changes: ["globs"],
			pre(prev, [glob, path, outcome]: [string, string, Outcome]) {
				return this.globs.some((g) => g.id === glob);
			},
			run(next, [glob, path, outcome]: [string, string, Outcome]) {
				const i = this.globs.findIndex((g) => g.id === glob);
				const g = this.globs[i];
				if (g === undefined) return;
				next.globs[i] = { id: g.id, pattern: g.pattern, dot: g.dot, nocase: g.nocase, expect: without(g.expect, path) };
				const changed = next.globs[i];
				if (changed !== undefined && outcome !== "none") changed.expect[path] = outcome;
			},
		},
		/** From the tree: the file at row i cycles the focused glob's expectation for it (none → match
		 * → no-match → none). */
		cyclePath: {
			pure: true,
			changes: ["globs"],
			constraints: { i: { int: true, min: 0 } },
			run(next, [i]: [number]) {
				const found = this.globs.findIndex((g) => g.id === this.focus);
				const gi = found < 0 ? 0 : found;
				const g = this.globs[gi];
				if (g === undefined) return;
				const r = tree(this.paths, g.pattern, g.dot, g.nocase).at(i);
				if (r === undefined || r.dir) return;
				const outcome = cycled(expected(g, r.path));
				next.globs[gi] = { id: g.id, pattern: g.pattern, dot: g.dot, nocase: g.nocase, expect: without(g.expect, r.path) };
				const changed = next.globs[gi];
				if (changed !== undefined && outcome !== "none") changed.expect[r.path] = outcome;
			},
		},
		/** Which glob the tree shows. */
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
			constraints: { at: { keyOf: "globs" } },
			run(next, [at]: [number | null]) {
				const g = at === null ? undefined : this.globs[at];
				if (g !== undefined) next.focus = g.id;
			},
		},
		setGlobAt: {
			pure: true,
			changes: ["globs"],
			constraints: { at: { keyOf: "globs" } },
			run(next, [at, pattern]: [number | null, string]) {
				if (at === null) return;
				const item = next.globs[at];
				if (item !== undefined) item.pattern = pattern;
			},
		},
		toggleDotAt: {
			pure: true,
			changes: ["globs"],
			constraints: { at: { keyOf: "globs" } },
			run(next, [at]: [number | null]) {
				if (at === null) return;
				const item = next.globs[at];
				if (item !== undefined) item.dot = !item.dot;
			},
		},
		toggleNocaseAt: {
			pure: true,
			changes: ["globs"],
			constraints: { at: { keyOf: "globs" } },
			run(next, [at]: [number | null]) {
				if (at === null) return;
				const item = next.globs[at];
				if (item !== undefined) item.nocase = !item.nocase;
			},
		},
		removeGlobAt: {
			pure: true,
			changes: ["globs", "focus"],
			constraints: { at: { keyOf: "globs" } },
			run(next, [at]: [number | null]) {
				const g = at === null ? undefined : this.globs[at];
				if (at === null || g === undefined || this.globs.length <= 1) return;
				next.globs.splice(at, 1);
				if (this.focus === g.id) next.focus = "";
			},
		},
	},
	loops: {
		tree: {
			enrich(key: number, row: TreeRow) {
				const nameClass = row.kind === "dir" ? "font-semibold opacity-70" : row.kind === "hit" ? "text-success" : "opacity-50";
				const markClass =
					row.mark === "pass" ? "badge badge-success badge-xs" : row.mark === "fail" ? "badge badge-error badge-xs" : "hidden";
				return { nameClass, markClass };
			},
		},
	},
	view: div(
		{ class: "flex flex-col gap-4" },
		header(
			{ class: "flex items-baseline justify-between gap-2" },
			h2({ class: "text-lg font-bold" }, "Glob lab"),
			span({ class: "text-sm opacity-70" }, field("headline")),
		),
		h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Globs"),
		div(
			{ class: "flex flex-col gap-1" },
			each(
				field("globRows"),
				div(
					{ class: "flex flex-col gap-1" },
					div(
						{ class: "join w-full items-center" },
						button(
							{ class: "btn btn-sm join-item font-mono", title: "Show in the tree", "on:click": send("focusAt", sourceKey()) },
							field("id"),
						),
						input({
							class: "input input-sm input-bordered join-item flex-1 font-mono",
							"aria-label": "Glob",
							value: field("pattern"),
							"on:input": send("setGlobAt", sourceKey(), targetValue()),
						}),
						label(
							{ class: "join-item flex items-center gap-1 bg-base-200 px-2 text-xs h-8" },
							input({ type: "checkbox", class: "checkbox checkbox-xs", checked: field("dot"), "on:change": send("toggleDotAt", sourceKey()) }),
							"dot",
						),
						label(
							{ class: "join-item flex items-center gap-1 bg-base-200 px-2 text-xs h-8" },
							input({
								type: "checkbox",
								class: "checkbox checkbox-xs",
								checked: field("nocase"),
								"on:change": send("toggleNocaseAt", sourceKey()),
							}),
							"nocase",
						),
						button(
							{ class: "btn btn-sm join-item", title: "Remove", "aria-label": "Remove", "on:click": send("removeGlobAt", sourceKey()) },
							"✕",
						),
					),
					when(field("error"), p({ class: "text-xs text-error" }, field("error"))),
				),
			),
			button({ class: "btn btn-sm btn-ghost w-fit", "on:click": send("addGlob", "**/*") }, "+ Glob"),
		),
		div(
			{ class: "grid gap-4 md:grid-cols-2" },
			div(
				{ class: "flex flex-col gap-1" },
				h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, "Paths, one per line"),
				textarea({
					class: "textarea textarea-bordered w-full font-mono text-xs",
					rows: "14",
					"aria-label": "Paths, one per line",
					value: field("paths"),
					"on:input": send("setPaths", targetValue()),
				}),
			),
			div(
				{ class: "flex flex-col gap-1" },
				h3(
					{ class: "text-xs font-semibold uppercase tracking-wide opacity-60" },
					"Tree for ",
					span({ class: "font-mono normal-case" }, field("focusLabel")),
				),
				p({ class: "text-xs opacity-60" }, "Click a file to cycle its expectation: none → match → no match."),
				each(
					field("tree"),
					button(
						{
							class: "flex items-center gap-2 text-left font-mono text-xs hover:bg-base-200",
							style: field("style"),
							title: field("title"),
							"on:click": send("cyclePath", sourceKey()),
						},
						span({ class: lookupBind("nameClass") }, field("name")),
						span({ class: "opacity-60" }, field("note")),
						span({ class: lookupBind("markClass") }, ""),
					),
					"tree",
				),
			),
		),
	),
};

export const register = { GlobLab: "GlobLab" };
