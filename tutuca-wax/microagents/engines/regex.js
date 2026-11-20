// regex-lab's host module: JavaScript regular expressions, as a module a
// pure-tutuca agent imports (import { error, test } from "microagents/regex").
// declaration is what pure-tutuca checks the agent against; make() gives the members,
// which answer rather than throw: a pattern that doesn't compile is null, or
// the text unhit.
//
//   error(pattern, flags)              "" or why it doesn't compile
//   test(pattern, flags, text)         whether it matches (g and y ignored); null when it doesn't compile
//   matches(pattern, flags, text, max) every match: [{ index, end, text, groups, named }]; null when it
//                                      doesn't compile
//   segments(pattern, flags, text)     text cut into [{ text, hit }], the matches hit; the text unhit
//                                      when it doesn't compile
export const declaration = {
	specifier: "microagents/regex",
	module: "Regex",
	members: {
		error: "(pattern: string, flags: string) => string",
		test: "(pattern: string, flags: string, text: string) => boolean | null",
		matches:
			"(pattern: string, flags: string, text: string, max: number) => { index: number; end: number; text: string; groups: (string | null)[]; named: { [key: string]: string } }[] | null",
		segments: "(pattern: string, flags: string, text: string) => { text: string; hit: boolean }[]",
	},
	fresh: ["Regex.matches", "Regex.segments"],
};
export const bundle = null;

const MAX = 500;
const cache = new Map();
const compile = (pattern, flags) => {
	const key = `${flags}/${pattern}`;
	if (!cache.has(key)) {
		if (cache.size > 256) cache.clear();
		try {
			cache.set(key, { re: new RegExp(pattern, flags), error: "" });
		} catch (error) {
			cache.set(key, { re: null, error: error.message });
		}
	}
	return cache.get(key);
};
const valid = (pattern, flags) => {
	const { re, error } = compile(pattern, flags);
	if (re === null) throw new Error(error);
	return re;
};
const matchesOf = (pattern, flags, text, max = MAX) => {
	const re = valid(pattern, flags.includes("g") ? flags : `${flags}g`);
	const out = [];
	for (const m of text.matchAll(re)) {
		out.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups: m.slice(1).map((g) => g ?? null), named: { ...(m.groups ?? {}) } });
		if (out.length >= max) break;
	}
	return out;
};

export const make = () => ({
	error: (pattern, flags) => compile(pattern, flags).error,
	test: (pattern, flags, text) => {
		const { re } = compile(pattern, flags.replace(/[gy]/g, ""));
		return re === null ? null : re.test(text);
	},
	matches: (pattern, flags, text, max) => (compile(pattern, flags).re === null ? null : matchesOf(pattern, flags, text, Math.min(max || MAX, MAX))),
	segments: (pattern, flags, text) => {
		if (compile(pattern, flags).re === null) return [{ text, hit: false }];
		const out = [];
		let at = 0;
		for (const m of matchesOf(pattern, flags, text)) {
			if (m.end === m.index) continue;
			if (m.index > at) out.push({ text: text.slice(at, m.index), hit: false });
			out.push({ text: m.text, hit: true });
			at = m.end;
		}
		if (at < text.length || out.length === 0) out.push({ text: text.slice(at), hit: false });
		return out;
	},
});
