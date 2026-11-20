// The well-known meta schemas, tutuca's (src/meta/display.js, the canvas's
// components/canvas/layout.js): what a component says about itself to the hosts that show it,
// under URIs that keep each convention apart. A module that registers them in a scope checks
// what every type registered or made below it says, and fills in the defaults when a host reads
// a type's meta.

/** How to show a component to people (a picker, a catalog, a storybook, a canvas's item header). */
export type Display = {
	/** What people call it, short: "Notes", "Tool call". */
	title: string | null;
	/** An emoji or a short symbol to show before the title. */
	icon: string | null;
	/** A sentence on what it's for, for a picker's or a catalog's entry. */
	description: string | null;
};
export const Display = { metaSchema: "https://tutuca.dev/meta/display" };

/** The class names a component's views compute, for a CSS compiler, which only sees constant ones. */
export type Classes = { classes: string };
export const Classes = { metaSchema: "https://tutuca.dev/meta/classes", defaults: { classes: "" } };

/** What a component says to a canvas holding it: how big its item starts (null: the canvas's),
 * and whether the item is see-through, without a background. */
export type Canvas = { width: number | null; height: number | null; transparent: boolean };
export const Canvas = {
	metaSchema: "https://tutuca.dev/meta/canvas",
	constraints: {
		width: { int: true, min: 0, max: 4000 },
		height: { int: true, min: 0, max: 4000 },
	},
};
