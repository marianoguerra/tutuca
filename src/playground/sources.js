// The module graph the playground edits: an entry module and the relative imports it reaches,
// loaded as text and linked back as blob URLs. Blob modules can't resolve relative
// specifiers, so each one is rewritten to the blob of the file it names, or to its absolute
// URL when it is outside the graph. Bare specifiers stay: the page's importmap applies to
// blob modules too. Imports of external files resolve to the URLs the page itself loads,
// so every run shares one copy of tutuca.

// The specifier of `import … from "x"`, `export … from "x"`, `import "x"` and `import("x")`.
const SPECIFIER =
	/(\bimport\s*\(\s*|\bimport\s+|\bfrom\s*)(["'])([^"'\n]+)\2|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

// Calls fn(specifier) for each import specifier in code and returns code with each one
// replaced by what fn returns; comments are left as they are.
export const mapSpecifiers = (code, fn) =>
	code.replace(SPECIFIER, (match, keyword, quote, specifier) =>
		specifier === undefined ? match : `${keyword}${quote}${fn(specifier)}${quote}`,
	);

export const importSpecifiers = (code) => {
	const specifiers = [];
	mapSpecifiers(code, (specifier) => {
		specifiers.push(specifier);
		return specifier;
	});
	return specifiers;
};

const isRelative = (specifier) => /^\.\.?\//.test(specifier);

// A url relative to the entry's folder, for file tabs.
export const relativeName = (url, base) => {
	const from = new URL(".", base).pathname.split("/").slice(0, -1);
	const to = new URL(url).pathname.split("/");
	let common = 0;
	while (common < from.length && from[common] === to[common]) common++;
	return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
};

// The files the entry reaches through relative imports, entry first, each as
// { url, name, code }. isExternal(url) stops the walk: those files are imported, not edited.
export const loadSources = async (
	entryUrl,
	{ fetch = globalThis.fetch, isExternal = () => false },
) => {
	const entry = new URL(entryUrl).href;
	const files = new Map();
	const load = async (url) => {
		if (files.has(url) || isExternal(url)) return;
		files.set(url, null);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`can't load ${url}: ${response.status}`);
		const code = await response.text();
		files.set(url, { url, name: relativeName(url, entry), code });
		for (const specifier of importSpecifiers(code)) {
			if (isRelative(specifier)) await load(new URL(specifier, url).href);
		}
	};
	await load(entry);
	return [...files.values()];
};

// Links files ({ url, code }) into blob modules, dependencies first, and returns the entry's
// blob URL (the first file) and revoke() to free them. createUrl turns code into a module URL.
export const linkSources = (
	files,
	{ createUrl = blobUrl, revokeUrl = (url) => URL.revokeObjectURL(url) } = {},
) => {
	const byUrl = new Map(files.map((file) => [file.url, file]));
	const linked = new Map();
	const visiting = [];
	const link = (url) => {
		const done = linked.get(url);
		if (done !== undefined) return done;
		if (visiting.includes(url)) {
			const cycle = [...visiting.slice(visiting.indexOf(url)), url].map(
				(u) => byUrl.get(u)?.name ?? u,
			);
			throw new Error(`the playground can't run import cycles: ${cycle.join(" → ")}`);
		}
		visiting.push(url);
		const code = mapSpecifiers(byUrl.get(url).code, (specifier) => {
			if (!isRelative(specifier)) return specifier;
			const target = new URL(specifier, url).href;
			return byUrl.has(target) ? link(target) : target;
		});
		visiting.pop();
		const result = createUrl(code);
		linked.set(url, result);
		return result;
	};
	const entry = link(files[0].url);
	return {
		entry,
		revoke() {
			for (const url of linked.values()) revokeUrl(url);
		},
	};
};

const blobUrl = (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));

// The books a module exports: values made with stories(), default first.
export const booksOf = (mod) =>
	Object.entries(mod)
		.sort(([a], [b]) => (a === "default" ? -1 : b === "default" ? 1 : 0))
		.map(([, value]) => value)
		.filter((value) => typeof value?.title === "string" && Array.isArray(value?.stories));
