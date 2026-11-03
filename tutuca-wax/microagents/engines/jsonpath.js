// Host functions for jsonpath-lab: JSONPath with jsonpath-plus.
//
//   jsonpath_problem(path)          "" or why path isn't a JSONPath (the slips jsonpath-plus lets through)
//   jsonpath_run(path, doc, max)    { count, results: [{ pointer, value }] } (at most max results,
//                                   resultType "all"); throws when the path is wrong
export const bundle = "jsonpath";

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

export const make = ({ JSONPath }) => {
	// { error, results } by path and the document's JSON text.
	const cache = new Map();
	const run = (path, doc) => {
		const key = `${path}\u0000${JSON.stringify(doc)}`;
		if (!cache.has(key)) {
			if (cache.size > 128) cache.clear();
			let out;
			const problem = pathProblem(path);
			if (problem) out = { error: problem, results: [] };
			else {
				try {
					const found = JSONPath({ path, json: doc, resultType: "all", wrap: true }) ?? [];
					out = { error: "", results: found.map((r) => ({ pointer: r.pointer, value: r.value ?? null })) };
				} catch (error) {
					out = { error: error.message, results: [] };
				}
			}
			cache.set(key, out);
		}
		return cache.get(key);
	};
	return {
		jsonpath_problem: (path) => pathProblem(path),
		jsonpath_run: (path, doc, max) => {
			const { error, results } = run(path, doc);
			if (error) throw new Error(error);
			return { count: results.length, results: results.slice(0, max > 0 ? max : 200) };
		},
	};
};
