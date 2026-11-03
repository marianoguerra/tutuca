// Host functions for glob-lab: glob patterns matched with picomatch (posix).
//
//   glob_paths(text)                          the paths of text: one per line, trimmed, blank lines skipped
//   glob_error(pattern, dot, nocase)          "" or why the pattern doesn't compile
//   glob_test(pattern, dot, nocase, path)     whether it matches path; throws when it doesn't compile
//   glob_filter(pattern, dot, nocase, paths)  the paths it matches (false when it doesn't compile)
//   glob_tree(text, pattern, dot, nocase)     text's paths as a file tree, depth first in the order
//                                             they first appear: [{ path, name, depth, dir, matched, note }]
//                                             (a directory's path ends in "/", its note is "n/m" matched;
//                                             matched is false everywhere when the pattern doesn't compile)
//   glob_explain(pattern, dot, nocase)        { regex, flags, base, glob, isGlob, negated }
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
	const valid = (pattern, dot, nocase) => {
		const m = matcher(pattern, dot, nocase);
		if (m.test === null) throw new Error(m.error);
		return m.test;
	};
	const trees = memo(64, (text) => treeOf(pathsOf(text)));
	return {
		glob_paths: (text) => pathsOf(text),
		glob_error: (pattern, dot, nocase) => matcher(pattern, dot, nocase).error,
		glob_test: (pattern, dot, nocase, path) => valid(pattern, dot, nocase)(path),
		glob_filter: (pattern, dot, nocase, paths) => {
			const test = valid(pattern, dot, nocase);
			return paths.filter((p) => test(p));
		},
		glob_tree: (text, pattern, dot, nocase) => {
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
		glob_explain: (pattern, dot, nocase) => {
			const opts = { dot, nocase };
			valid(pattern, dot, nocase);
			const re = picomatch.makeRe(pattern, opts);
			const scan = picomatch.scan(pattern, opts);
			return { regex: re.source, flags: re.flags, base: scan.base, glob: scan.glob, isGlob: scan.isGlob, negated: scan.negated };
		},
	};
};
