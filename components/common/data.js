// Helpers for a component's data meta (DATA_META, src/data.js) when what its load takes is
// described by a JSON Schema rather than an arg type.
import { t } from "../../src/tutuca.js";
import { validate } from "../llm/validate.js";

// What a load message whose arg must match schema spreads in: an any arg, and a pre that
// checks it, whose why lists where it doesn't match.
export const schemaChecked = (schema) => ({
	args: [t.any()],
	pre: (_self, [value]) => validate(schema, value).length === 0,
	why: (_self, [value]) =>
		validate(schema, value)
			.slice(0, 5)
			.map(({ path, message }) => `${path} ${message}`)
			.join("; "),
});
