// jsonpath-lab's host module: JSONPath with jsonpath-plus, as a module a pure-tutuca agent
// imports (import { pathProblem, runPath } from "microagents/jsonpath"). declaration is what pure-tutuca
// checks the agent against; make() gives the members, which answer rather than throw.
//
//   pathProblem(path)            "" or why path isn't a JSONPath (the slips jsonpath-plus lets through)
//   runPath(path, doc, max)      { error, count, results: [{ pointer, value }] } (at most max results,
//                                resultType "all"); error is "" when it ran, else why (count 0, no results)
//   documentNodes(doc, max)      the document's nodes, depth first, at most max: [{ pointer, depth, key,
//                                text, type }] (key "$" for the root, an index, or the quoted name; text
//                                "[n items]", "{n keys}" or a scalar's JSON; type JSON's name of it)
export const declaration = {
	specifier: "microagents/jsonpath",
	module: "JsonPath",
	members: {
		pathProblem: "(path: string) => string",
		runPath:
			"(path: string, doc: unknown, max: number) => { error: string; count: number; results: { pointer: string; value: unknown }[] }",
		documentNodes:
			"(doc: unknown, max: number) => { pointer: string; depth: number; key: string; text: string; type: string }[]",
	},
	fresh: ["JsonPath.runPath", "JsonPath.documentNodes"],
};
export const bundle = "jsonpath";

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v);
const escape = (key) => key.replaceAll("~", "~0").replaceAll("/", "~1");

// Every node of doc, depth first, at most max.
const nodesOf = (doc, max) => {
	const out = [];
	const walk = (v, at, key, depth) => {
		if (out.length >= max) return;
		const isList = Array.isArray(v);
		const isMap = !isList && v !== null && typeof v === "object";
		const keys = isMap ? Object.keys(v) : [];
		const text = isList ? `[${v.length} items]` : isMap ? `{${keys.length} keys}` : JSON.stringify(v);
		out.push({ pointer: at, depth, key, text, type: typeOf(v) });
		if (isList) v.forEach((x, i) => walk(x, `${at}/${i}`, `${i}`, depth + 1));
		if (isMap) for (const k of keys) walk(v[k], `${at}/${escape(k)}`, JSON.stringify(k), depth + 1);
	};
	walk(doc, "", "$", 0);
	return out;
};

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
		pathProblem: (path) => pathProblem(path),
		runPath: (path, doc, max) => {
			const { error, results } = run(path, doc);
			if (error) return { error, count: 0, results: [] };
			return { error: "", count: results.length, results: results.slice(0, max > 0 ? max : 200) };
		},
		documentNodes: (doc, max) => nodesOf(doc ?? null, max > 0 ? max : 1500),
	};
};
