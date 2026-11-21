// Small helpers the components share.

import { apply } from "../../src/tutuca.js";

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
// Applies the pure message name to each component of items, in place.
export const applyEach = (items, name, ...args) => {
	items.forEach((item, i) => {
		items[i] = apply(item, name, ...args);
	});
};
// What the user typed as a number: NaN when it's blank or doesn't read as one.
export const asNumber = (text) => (text.trim() === "" ? Number.NaN : Number(text));
