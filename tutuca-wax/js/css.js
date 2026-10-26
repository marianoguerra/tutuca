// CSS for the classes components use: margaui-css.wasm (vendor/margaui), the
// Tailwind CSS v4 compiler with margaui's components built in, compiles a set
// of class names, and classStyles keeps the set that the loaded component
// modules' views use (loadComponent's classes), compiling it again into a
// <style> each time it grows.
import { readBytes } from "./tutuca-rt.js";

// The compiler, from a URL or its bytes: css(classes) -> the CSS they need,
// base styles included, themes not (vendor/margaui/themes). It imports
// nothing, and needs the engine's js-string builtins.
export async function loadCssCompiler(source = new URL("../vendor/margaui/margaui-css.wasm", import.meta.url)) {
	const bytes = source instanceof URL ? await readBytes(source) : source;
	const { instance } = await WebAssembly.instantiate(bytes, {}, { builtins: ["js-string"], importedStringConstants: "_" });
	return (classes) => instance.exports.css([...classes].join(" "));
}

// The classes seen so far, starting with extra (classes that come from
// elsewhere, like the page around the components): add(classes) adds them,
// each entry split on whitespace, and when any is new writes compile(all of
// them) into style. It says whether any was new.
export function classStyles(compile, style, extra = []) {
	const seen = new Set();
	const update = () => {
		style.textContent = compile(seen);
	};
	const add = (classes) => {
		const before = seen.size;
		for (const entry of classes) for (const c of entry.split(/\s+/)) if (c !== "") seen.add(c);
		if (seen.size !== before) update();
		return seen.size !== before;
	};
	add(extra);
	if (seen.size === 0) update();
	return { add, classes: () => [...seen] };
}
