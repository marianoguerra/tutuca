// The display meta convention: what a component says about itself to whoever shows components to
// people (a component selector, a catalog, a storybook, a canvas's item header, a notebook's
// cell): its title, an icon to go with it, and a sentence on what it's for. Any host reads it;
// a host's own concerns (a canvas's sizes) go under a URI of its own.
//
// A component declares it with component({ meta: { [DISPLAY_META]: { title, icon, description } } }),
// every key optional; a scope that registers displayMetaSchemas checks it, and fills the missing
// keys with null.
import { metaOf, t } from "../tutuca.js";

export const DISPLAY_META = "https://tutuca.dev/meta/display";
export const displayMetaSchemas = {
	[DISPLAY_META]: {
		// What people call it, short: "Notes", "Tool call".
		title: t.option(t.string()),
		// An emoji or a short symbol to show before the title.
		icon: t.option(t.string()),
		// A sentence on what it's for, for a picker's or a catalog's entry.
		description: t.option(t.string()),
	},
};
// What c (a component or, with scope, its spec) says to display it.
export const displayOf = (c, scope = undefined) => metaOf(c, DISPLAY_META, scope);
// c's icon and title, as a label ("📝 Notes"), or null when it has no title.
export const displayLabel = (c, scope = undefined) => {
	const { title, icon } = displayOf(c, scope);
	if (typeof title !== "string" || title === "") return null;
	return typeof icon === "string" && icon !== "" ? `${icon} ${title}` : title;
};
