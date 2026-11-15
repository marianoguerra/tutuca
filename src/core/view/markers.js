// The comments tutuca wraps rendered components and loop items in: §{json}§ opens one and §/§
// closes it. Events read them back to find the path of the component they happened in.
import { Frame } from "../../tree/index.js";
import { VComment } from "../../vdom/index.js";

export const MARKER_CLOSE = "§/§";
// One shared closing comment, so morph skips it by identity.
const MARKER_END = new VComment(MARKER_CLOSE);
const open = (marker) => new VComment(`§${JSON.stringify(marker)}§`);
// One shared comment opens every component, too.
const COMPONENT_OPEN = open({ t: "component" });
// node, a component's view, between the comments that say a component rendered here; provides,
// when the component provides values, is where each one is in it: { name: keys }.
export const wrapComponent = (node, provides = null) => [
	provides === null ? COMPONENT_OPEN : open({ t: "component", p: provides }),
	node,
	MARKER_END,
];
// node between the comments that say frame is the path to what's inside.
export const wrapFrame = (frame, node) => wrapOpen(frameOpen(frame), node);
// The comment that opens frame, and node between it and a closing one: wrapFrame in two steps,
// for what needs the opening's text first (a render cache's slot).
export const frameOpen = (frame) => open(frameMarker(frame));
export const wrapOpen = (opening, node) => [opening, node, MARKER_END];
export const isMarkerOpen = (text) => text.startsWith("§{") && text.endsWith("§");
// The marker an opening comment's text holds; throws on bad json.
export const parseMarker = (text) => JSON.parse(text.slice(1, -1));

// What a marker says, as its json: a component rendered here, { t: "component" }, with p, the
// keys to each value it provides ({ name: keys }), when it provides any; or a frame of the path
// to what's inside, { t: "frame", p, k, i }, its keys and item in short form, p being { v: name }
// when its source is a provided value. A frame says what it reads and the component that
// provides it says where it is, so a render holds nothing of its place, or of where its providers
// are: the cache reuses it anywhere the same values are provided.
const frameMarker = (frame) => {
	const { provider: p } = frame;
	return { t: "frame", p: p === null ? null : { v: p.name }, k: frame.keys, i: frame.item };
};
// The name of the provided value a frame marker's frame starts from, null when it's none.
export const providedNameOf = (marker) => marker.p?.v ?? null;
// What a component marker's component provides, { name: keys }; null when it's nothing.
export const providesOfMarker = (marker) => marker.p ?? null;
// The frame a frame marker holds; provider, { name, up, keys }, is where the value it names is,
// as whoever reads the markers around it found (pathOfMarkers).
export const frameOfMarker = ({ k, i }, provider = null) => new Frame(k, i, provider);
export const isComponentMarker = (marker) => marker?.t === "component";
export const isFrameMarker = (marker) => marker?.t === "frame";
// Whether marker is one of tutuca's: comments from unmanaged DOM can look alike.
export const isTutucaMarker = (marker) => isComponentMarker(marker) || isFrameMarker(marker);
