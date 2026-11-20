// @data {"Card.meta.urn:example:agent": "{ tools?: { name: string }[] }"}
// @expect not-assignable
export const Card = { meta: { "urn:example:agent": { tools: [{ name: 1 }] } } };
