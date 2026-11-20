// Meta schemas: a const object that says metaSchema, with a type of its name (its fields), and
// defaults and constraints as a component's. A component's meta under the URI is checked against
// it where the schema is registered.
import { div, field } from "tutuca/view";

export type Badge = { label: string | null; size: number | null; round: boolean };
export const Badge = {
	metaSchema: "urn:example:badge",
	defaults: { round: false },
	constraints: { size: { int: true, min: 1, max: 64 } },
};

export type Tag = { text: string };
export const Tag = {
	meta: { "urn:example:badge": { label: "Tag", size: 16 } },
	defaults: { text: "" },
	view: div({}, field("text")),
};
