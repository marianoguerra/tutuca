// The micro-agents' kit: what every agent's root is to the shell (MicroAgent), and the
// components agents share. The shell loads it into the root scope, so an agent that imports it
// finds them there.
import { field, h3 } from "tutuca/view";

/** What the shell needs of an agent's root: made from the JSON it opens (its fields), it says
 * what it holds for the model (summary), what getState answers (domain), and the JSON it exports
 * (data). */
export interface MicroAgent {
	/** A short text, with ids, that the system prompt includes. */
	readonly summary: string;
	/** The state as plain JSON, for getState. */
	readonly domain: unknown;
	/** The JSON the agent's data exports as: what it opened, changed. */
	readonly data: unknown;
}

/** A section's title in an agent's workspace. */
export type SectionTitle = { text: string };
export const SectionTitle = {
	defaults: { text: "" },
	view: h3({ class: "text-xs font-semibold uppercase tracking-wide opacity-60" }, field("text")),
};

export const register = { SectionTitle: "SectionTitle" };
