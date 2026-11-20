// What tutuca-wasm's pages share: making elements, margaui's themes and the CSS for the classes
// in use, and reading component modules with the modules they import.

export const el = (tag, attrs = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v);
	}
	node.append(...children.filter((c) => c != null));
	return node;
};

export const textOf = async (url) => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return response.text();
};

/**
 * margaui's light and dark themes into #themes, following the system's, and the CSS for the
 * classes in use into #classes: margaui-css.wasm (Tailwind's compiler with margaui's
 * components) compiles the set, which grows with what the page shows. Gives { add(lists),
 * watch(node), count() }: add takes class attributes' values; watch adds the classes of
 * whatever a node comes to hold.
 */
export async function pageStyles(margaui, classes = []) {
	const themes = await Promise.all(
		["light", "dark"].map((t) => textOf(new URL(`themes/${t}.css`, margaui))),
	);
	document.querySelector("#themes").textContent = themes.join("\n");
	const dark = matchMedia("(prefers-color-scheme: dark)");
	const followTheme = () => {
		document.documentElement.dataset.theme = dark.matches ? "dark" : "light";
	};
	followTheme();
	dark.addEventListener("change", followTheme);
	const compiler = await WebAssembly.instantiate(
		await (await fetch(new URL("margaui-css.wasm", margaui))).arrayBuffer(),
		{},
		{ builtins: ["js-string"], importedStringConstants: "_" },
	);
	const seen = new Set();
	const style = document.querySelector("#classes");
	const add = (lists) => {
		const before = seen.size;
		for (const list of lists) for (const c of String(list).split(/\s+/)) if (c !== "") seen.add(c);
		if (seen.size !== before)
			style.textContent = compiler.instance.exports.css([...seen].join(" "));
		return seen.size !== before;
	};
	const scan = (node) =>
		add([...node.querySelectorAll("[class]")].map((n) => n.getAttribute("class")));
	const watch = (node) => {
		scan(node);
		new MutationObserver(() => scan(node)).observe(node, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["class"],
		});
	};
	add(classes);
	return { add, watch, count: () => seen.size };
}

/** The module a specifier names from another: "../meta/meta.tutuca" from components/counter/.... */
export const pathFrom = (from, spec) => {
	const url = new URL(spec.endsWith(".ts") ? spec : `${spec}.ts`, new URL(from, "file:///"));
	return url.pathname.slice(1);
};

/**
 * Component modules under a base URL, by path. read(path) is a module's text, fetched once;
 * load(tutuca, path, { text, ...options }) loads one into a runtime with the component modules
 * it imports types from resolved (text is the module's own, when the page has it edited).
 */
export function moduleSources(base, own = {}) {
	const fetched = new Map();
	const read = async (path) => {
		if (own[path] !== undefined) return own[path];
		if (!fetched.has(path)) fetched.set(path, await textOf(new URL(path, base)));
		return fetched.get(path);
	};
	const withImports = async (path, text, into = new Map()) => {
		if (into.has(path)) return into;
		const source = text ?? (await read(path));
		into.set(path, source);
		for (const m of source.matchAll(/from "(\.[^"]*\.tutuca)(?:\.ts)?"/g)) {
			await withImports(pathFrom(path, m[1]), undefined, into);
		}
		return into;
	};
	const load = async (tutuca, path, { text, ...options } = {}) => {
		const sources = await withImports(path, text);
		const resolve = (spec) => sources.get(pathFrom(path, spec)) ?? null;
		const source = sources.get(path);
		return { source, ...(await tutuca.load(source, { resolve, ...options })) };
	};
	return { read, load };
}
