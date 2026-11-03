// Host functions for regex-lab: JavaScript regular expressions.
//
//   regex_error(pattern, flags)            "" or why it doesn't compile
//   regex_test(pattern, flags, text)       whether it matches (g and y ignored); throws when invalid
//   regex_matches(pattern, flags, text, max)
//                                          every match: [{ index, end, text, groups, named }]
//   regex_segments(pattern, flags, text)   text cut into [{ text, hit }], the matches hit
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
	regex_error: (pattern, flags) => compile(pattern, flags).error,
	regex_test: (pattern, flags, text) => valid(pattern, flags.replace(/[gy]/g, "")).test(text),
	regex_matches: (pattern, flags, text, max) => matchesOf(pattern, flags, text, Math.min(max || MAX, MAX)),
	regex_segments: (pattern, flags, text) => {
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
