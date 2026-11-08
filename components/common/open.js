// Trees of components that open and close: what reaches the nodes below one, and the buttons
// that open or close them all.
import { apply, canApply, send, tag } from "../../src/tutuca.js";

const { button } = tag;

// Applies the pure message name(...args) in place to the components at next's keys (a
// component or an array of them) that support it.
export const applyBelow = (next, keys, name, ...args) => {
	for (const key of keys) {
		const v = next[key];
		if (Array.isArray(v)) {
			v.forEach((k, i) => {
				if (canApply(k, name)) v[i] = apply(k, name, ...args);
			});
		} else if (canApply(v, name)) next[key] = apply(v, name, ...args);
	}
};
// Expand all and collapse all, right aligned: they send setOpenDeep with true and false.
export const openAllButtons = (cls = "btn btn-xs btn-ghost font-mono") => [
	button(
		{ class: `${cls} ml-auto expand-all`, "on:click": send("setOpenDeep", true) },
		"expand all",
	),
	button({ class: `${cls} collapse-all`, "on:click": send("setOpenDeep", false) }, "collapse all"),
];
