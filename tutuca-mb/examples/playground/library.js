// Component libraries in the playground. A library is several packages: its stories, its
// components and the example packages those build on (examples/common, examples/json_editor,
// …), each compiled on its own, in dependency order, as moon builds them (compile.js). No
// dependencies, so the node smoke script uses it as the page does.

// The editor's name for a file of a library: its path under examples/ ("jsonschema/views.mbt"),
// so files of two packages never clash; a site example's file is named by itself.
export const fileKey = (example, path) =>
	example.packages === undefined ? path.split("/").pop() : path.replace(/^\.\.\//, "");

// `example`'s packages (examples.js) as compile.js compiles them, `text(path)` giving each
// file's code: { name, uses: { alias: package name }, std, files: [[key, code]] }.
export const packagesOf = (example, text) => {
	const nameOf = new Map(example.packages.map((p) => [p.dir, p.name]));
	return example.packages.map((p) => ({
		name: p.name,
		uses: Object.fromEntries(Object.entries(p.uses ?? {}).map(([alias, dir]) => [alias, nameOf.get(dir)])),
		...(p.std ? { std: p.std } : {}),
		files: p.files.map((path) => [fileKey(example, path), text(path)]),
	}));
};

// Whether a file of `example` compiles for `backend` ("js" or "wasm-gc"): all but the
// target-only files of another backend do.
export const compiles = (example, backend) => {
	const only = new Map(
		(example.packages ?? []).flatMap((p) => Object.entries(p.targets ?? {})),
	);
	return (name) => !only.has(name.split("/").pop()) || only.get(name.split("/").pop()).includes(backend);
};
