// Metadata comments (spec/bind/meta.rkt): how the DOM records the semantic tree's wrappers.
//
// A wrapper becomes an opening comment before its children and the closing comment §/§ after
// them. The opening comment says what the wrapper is: { t: "component" }, a component boundary.
export const META_CLOSE = "§/§";

// The text of a metadata comment.
export const metaString = (meta) => `§${JSON.stringify(meta)}§`;

const isMeta = (meta) => meta !== null && typeof meta === "object" && meta.t === "component";

// The inverse on well-formed metadata; null for any other comment, including look-alikes with
// an unknown t or text that is not JSON.
export function stringMeta(string) {
	if (!string.startsWith("§{") || !string.endsWith("§")) return null;
	try {
		const meta = JSON.parse(string.slice(1, -1));
		return isMeta(meta) ? meta : null;
	} catch {
		return null;
	}
}
