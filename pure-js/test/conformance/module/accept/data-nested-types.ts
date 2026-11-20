// @data {"Card.meta.urn:example:agent": "{ tools?: { name: string; params?: string[] }[]; summary?: string }"}
// A data member's object literal with no type of its own: the members the embedder types are
// checked (an empty list takes its element type from it), the others are as written.
export const Card = {
	meta: {
		"urn:example:agent": { tools: [{ name: "inc", params: [] }], summary: "summary" },
		"urn:example:other": { width: 240 },
	},
};
