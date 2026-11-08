// The meta the components say about themselves, to whoever shows them.
import { DISPLAY_META } from "../../src/meta/index.js";

// How a component sits on a canvas: see canvasMetaSchemas (canvas/layout.js).
export const CANVAS_META = "https://tutuca.dev/meta/canvas";

// What a component says of itself (its title, icon and what it's for), how wide it starts on a
// canvas (the canvas's default when null) and more meta, by URI.
export const metaFor = (title, icon, description, width = null, more = {}) => ({
	[DISPLAY_META]: icon === null ? { title, description } : { title, icon, description },
	...(width === null ? {} : { [CANVAS_META]: { width } }),
	...more,
});

// A kind a canvas hole can become: a component, made with C by make(C), and more about it
// (its width, its choices).
export const kind = (component, make, more = {}) => ({ component, make: (C) => make(C), ...more });
