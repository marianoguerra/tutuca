// Paths as the tree and its agents write them: pathKey tells two apart (a row's key, a place's),
// pathLabel reads one as the tree prints its steps.
import { jsonText, keyText } from "../../src/tree/text.js";

// What tells two paths apart, as text: each frame's provider, keys and item.
export const pathKey = (path) =>
	JSON.stringify(
		path.frames.map(({ provider: p, keys, item }) => [
			p === null ? null : [p.name, p.up, p.keys],
			keys,
			item,
		]),
	);
// A frame as the tree prints its step: .field, .seq[key], *provided.
export const frameText = ({ provider, keys, item }) => {
	const start = provider === null ? "" : `*${provider.name}`;
	return `${start}${keys.map(keyText).join("")}${item === null ? "" : `[${jsonText(item)}]`}`;
};
export const pathLabel = (path) => path.frames.map(frameText).join(" ") || "·";
