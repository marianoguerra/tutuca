// The comments tutuca wraps rendered components and loop items in: §{json}§ opens one and §/§
// closes it. Events read them back to find the path of the component they happened in.
import { VComment } from "./vdom.js";

export const MARKER_CLOSE = "§/§";
// One shared closing comment, so morph skips it by identity.
const MARKER_END = new VComment(MARKER_CLOSE);
// node between the comment that opens marker and the one that closes it.
export const wrapMarkers = (marker, node) => [
	new VComment(`§${JSON.stringify(marker)}§`),
	node,
	MARKER_END,
];
export const isMarkerOpen = (text) => text.startsWith("§{") && text.endsWith("§");
// The marker an opening comment's text holds; throws on bad json.
export const parseMarker = (text) => JSON.parse(text.slice(1, -1));
