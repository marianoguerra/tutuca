// The trail's Probe (trail.js) with one tool more, check_component, which checks a pure-tutuca
// module's source against the scope of the component at a place, defining nothing, and answers
// every error and warning with where it is and how to fix it. Defining and adding are what the
// components there do (a Shelf's define, a component editor's register), which send sends.
// checkAsks answers it, for attachTrail's extraAsks (live.js). It needs pure-js: a page that
// loads it maps "pure-js".
import { agentTool } from "../../src/meta/index.js";
import { checkComponentSource } from "../../src/pure/define.js";
import { checkReportText } from "../../src/pure/define-text.js";
import { scopeOf, t } from "../../src/tutuca.js";
import { GONE, placeAt, probeWith, trailComponents, whereType } from "./trail.js";

const PROMPT = `You can also grow the application with components of your own. A component is a
pure-tutuca module: TypeScript that exports a type and a const of the same name. The type says
its fields (and its queries, as readonly members); the const its defaults, its handlers (on),
its queries and its view. A handler reads this and changes next; it can't change this. For
example:

import { button, div, field, send, span } from "tutuca/view";
export type Card = { title: string; count: number };
export const Card = {
	defaults: { title: "Card", count: 0 },
	on: { inc: { run(next) { next.count += 1; } } },
	view: div(span(field("title")), button({ "on:click": send("inc") }, field("count"))),
};

Components are defined where a component that defines them is: a Shelf (its define and add
messages), a component editor (its setSource, register and addToCanvas messages). Go to it,
check_component the source until it checks, then send it the source to define, then ask it to
add one by name. spec says what a place can make (makes). To change a component you defined,
define it again under the same name: the ones there move onto the new definition and keep their
state. A field the old one didn't have needs a default.`;

export const CheckingProbe = probeWith({
	prompt: PROMPT,
	tools: [
		agentTool(
			"check_component",
			"message",
			["source", "where"],
			"Check a pure-tutuca component module's source against the scope of the component at a place, defining nothing: answers whether it checks, the components it defines, which it would give a new definition, and every error and warning with its line, column and how to fix it.",
			{ target: "checkComponentAt", result: "checked" },
		),
	],
	fields: { lastCheck: t.string() }, // What the last check said.
	queries: {
		// What answers its check_component tool.
		get checked() {
			return this.lastCheck;
		},
	},
	on: {
		checkComponentAt: {
			args: [t.string({ minLength: 1 }), whereType()],
			emits: { ask: ["checkApp"] },
			pre: (self, [_source, where]) => placeAt(self, where)?.spec != null,
			why: (self, [_source, where]) => {
				const node = placeAt(self, where);
				return node === null ? GONE : `There's no component at ${node.label} to check it in.`;
			},
			run(next, [source, where], ctx) {
				next.lastCheck = "";
				ctx.ask("checkApp", [placeAt(this, where).key, source]);
			},
		},
	},
	answers: {
		// The report's text, or { error }.
		checkApp: {
			ok(next, [result]) {
				next.lastCheck = result?.error
					? `It wasn't checked: ${result.error}`
					: String(result?.text);
			},
			error(next, [error]) {
				next.lastCheck = `It wasn't checked: ${error?.message ?? error}`;
			},
			unhandled(next) {
				next.lastCheck = "It wasn't checked: this page can't check components.";
			},
		},
	},
});

// The trail's components with this Probe.
export const checkingTrailComponents = { ...trailComponents, Probe: CheckingProbe };

// What answers check_component, for attachTrail's extraAsks: source checked in the scope of the
// component at the place key, defining nothing: { text }, the report as the agent reads it, or
// { error }.
export const checkAsks = (placeOf) => ({
	checkApp: ([key, source]) => {
		const place = placeOf(key);
		if (place === null) return { error: "that place is no longer in the tree" };
		const scope = scopeOf(place.instance);
		if (scope == null) return { error: "the component there has no scope" };
		return { text: checkReportText(checkComponentSource(source, scope)) };
	},
});
