// glob-lab's host module: glob patterns matched with picomatch (posix), as a
// module a pure-tutuca agent imports (import { test } from "microagents/glob").
// declaration is what pure-tutuca checks the agent against; make(engine) gives the
// members, which answer rather than throw: a pattern that doesn't compile
// matches nothing.
//
//   pathsOf(text)                         the paths of text: one per line, trimmed, blank lines skipped
//   errorOf(pattern, dot, nocase)         "" or why the pattern doesn't compile
//   test(pattern, dot, nocase, path)      whether it matches path; false when it doesn't compile
//   filter(pattern, dot, nocase, paths)   the paths it matches; null when it doesn't compile
//   tree(text, pattern, dot, nocase)      text's paths as a file tree, depth first in the order
//                                         they first appear: [{ path, name, depth, dir, matched, note }]
//                                         (a directory's path ends in "/", its note is "n/m" matched;
//                                         matched is false everywhere when the pattern doesn't compile)
//   explain(pattern, dot, nocase)         { regex, flags, base, glob, isGlob, negated }; null when it
//                                         doesn't compile
export const declaration = {
	specifier: "microagents/glob",
	module: "Glob",
	members: {
		pathsOf: "(text: string) => string[]",
		errorOf: "(pattern: string, dot: boolean, nocase: boolean) => string",
		test: "(pattern: string, dot: boolean, nocase: boolean, path: string) => boolean",
		filter: "(pattern: string, dot: boolean, nocase: boolean, paths: string[]) => string[] | null",
		tree: "(text: string, pattern: string, dot: boolean, nocase: boolean) => { path: string; name: string; depth: number; dir: boolean; matched: boolean; note: string }[]",
		explain:
			"(pattern: string, dot: boolean, nocase: boolean) => { regex: string; flags: string; base: string; glob: string; isGlob: boolean; negated: boolean } | null",
	},
	fresh: ["Glob.pathsOf", "Glob.filter", "Glob.tree", "Glob.explain"],
};
export const bundle = "picomatch";

const memo = (n, f) => {
	const cache = new Map();
	return (key) => {
		if (!cache.has(key)) {
			if (cache.size >= n) cache.clear();
			cache.set(key, f(key));
		}
		return cache.get(key);
	};
};

const pathsOf = (text) =>
	text
		.split("\n")
		.map((s) => s.trim())
		.filter((s) => s !== "");

// The paths as tree rows, { path, name, depth, dir }.
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

export const make = (engine) => {
	const picomatch = engine.default;
	// { test, error } keyed by dot, nocase (0/1) and the pattern.
	const compile = memo(500, (key) => {
		const opts = { dot: key[0] === "1", nocase: key[1] === "1" };
		try {
			return { test: picomatch(key.slice(2), opts), error: "" };
		} catch (e) {
			return { test: null, error: e.message };
		}
	});
	const matcher = (pattern, dot, nocase) => compile(`${dot ? 1 : 0}${nocase ? 1 : 0}${pattern}`);
	const trees = memo(64, (text) => treeOf(pathsOf(text)));
	return {
		pathsOf: (text) => pathsOf(text),
		errorOf: (pattern, dot, nocase) => matcher(pattern, dot, nocase).error,
		test: (pattern, dot, nocase, path) => matcher(pattern, dot, nocase).test?.(path) ?? false,
		filter: (pattern, dot, nocase, paths) => {
			const { test } = matcher(pattern, dot, nocase);
			return test === null ? null : paths.filter((p) => test(p));
		},
		tree: (text, pattern, dot, nocase) => {
			const test = matcher(pattern, dot, nocase).test ?? (() => false);
			const paths = pathsOf(text);
			return trees(text).map((r) => {
				if (!r.dir) {
					const matched = test(r.path);
					return { ...r, matched, note: matched ? "✓" : "" };
				}
				const under = paths.filter((x) => x.startsWith(r.path));
				return { ...r, matched: false, note: `${under.filter((x) => test(x)).length}/${under.length}` };
			});
		},
		explain: (pattern, dot, nocase) => {
			if (matcher(pattern, dot, nocase).test === null) return null;
			const opts = { dot, nocase };
			try {
				const re = picomatch.makeRe(pattern, opts);
				const scan = picomatch.scan(pattern, opts);
				return { regex: re.source, flags: re.flags, base: scan.base, glob: scan.glob, isGlob: scan.isGlob, negated: scan.negated };
			} catch {
				return null;
			}
		},
	};
};
