// Normalization (spec/view/normalize.rkt): from the values expressions evaluate to (results)
// to a flat sequence of semantic nodes.
import { SNode, text } from "./sem.js";

// Iterables (never strings) splice; null and undefined drop; nodes stay; anything else becomes
// text with String().
export function normalize(result) {
	if (result == null) return [];
	if (result instanceof SNode) return [result];
	if (typeof result !== "string" && typeof result[Symbol.iterator] === "function") {
		return Array.from(result).flatMap(normalize);
	}
	return [text(String(result))];
}

// A key is a string; null and undefined are no key.
export const keyOf = (result) => (result == null ? null : String(result));
