// What the playground and the studio pages share: making elements, margaui's
// themes and the CSS for the classes in use, and the compiler worker
// (playground/compiler.worker.js), asked through promises.
import { classStyles, loadCssCompiler } from "./css.js";

export const el = (tag, attrs = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v);
	}
	node.append(...children.filter((c) => c != null));
	return node;
};

// margaui's light and dark themes into #themes, following the system's, and
// the CSS for classes (the page's own) and the components' into #classes.
export async function pageStyles(classes) {
	const vendor = (path) => new URL(`../vendor/margaui/${path}`, import.meta.url);
	const themes = await Promise.all(["light", "dark"].map(async (t) => (await fetch(vendor(`themes/${t}.css`))).text()));
	document.querySelector("#themes").textContent = themes.join("\n");
	const dark = matchMedia("(prefers-color-scheme: dark)");
	const followTheme = () => {
		document.documentElement.dataset.theme = dark.matches ? "dark" : "light";
	};
	followTheme();
	dark.addEventListener("change", followTheme);
	return classStyles(await loadCssCompiler(vendor("margaui-css.wasm")), document.querySelector("#classes"), classes);
}

// compiler(action, request) resolves with what the worker's tcd answers
// (check, stub, model, build, or version: its tcd.wasm's hash).
export function compilerClient() {
	const worker = new Worker(new URL("../playground/compiler.worker.js", import.meta.url), { type: "module" });
	let nextId = 0;
	const pending = new Map();
	worker.onmessage = ({ data: { id, response, error } }) => {
		const p = pending.get(id);
		pending.delete(id);
		if (error) p.reject(new Error(error));
		else p.resolve(response);
	};
	worker.onerror = (e) => {
		for (const p of pending.values()) p.reject(new Error(e.message || "the compiler worker failed"));
		pending.clear();
	};
	return (action, request) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, action, request });
		});
}
