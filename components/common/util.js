// Small helpers the components share.

// Objects merged into one by descriptor, so getters stay getters (spreading would read them once).
export const mix = (...objects) =>
	Object.defineProperties(
		{},
		Object.assign({}, ...objects.map((o) => Object.getOwnPropertyDescriptors(o))),
	);
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// "1 thing", "2 things"; many when the plural isn't one + s.
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Whether Ctrl (⌘ on a Mac) was held during event e.
export const isModKey = (e) => Boolean(e?.ctrlKey || e?.metaKey);
// A small, quieter line of text.
export const NOTE = "text-xs opacity-80";
