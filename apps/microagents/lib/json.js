// JSON helpers the agents share: the ones in components/data-views/json.js (parsing JSON text,
// pointers, a document as tree rows), plus comparing a part's data with JSON text.
import { parse } from "../../../components/data-views/json.js";
import { toJson } from "../core/tdata.js";

export * from "../../../components/data-views/json.js";

// Whether the part's data is the JSON text says (compared as JSON, so formatting doesn't count).
export const sameAsPart = (m, text) => {
	const { value, error } = parse(text);
	if (error !== "" || m?.data === undefined) return false;
	try {
		return JSON.stringify(toJson(m.data)) === JSON.stringify(value);
	} catch {
		return false;
	}
};
