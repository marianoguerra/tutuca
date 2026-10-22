// 1. A counter: a component is a name, typed fields, a view and the messages it handles.
// Click the buttons in Preview, then open Steps to replay the "count to three" sequence.
import { component, field, send, t, tag } from "tutuca";
import { step, stories } from "tutuca/storybook";

const { button, div, span } = tag;

export const Counter = component({
	name: "Counter",
	// Fields are schemas: count is a number that starts at 0.
	fields: { count: t.number() },
	// The view is data: send("inc") is the message a click sends to this component.
	view: div(
		{ class: "flex items-center gap-3" },
		button({ class: "btn", "on:click": send("dec") }, "−"),
		span({ class: "text-2xl font-bold tabular-nums" }, field("count")),
		button({ class: "btn btn-primary", "on:click": send("inc") }, "+"),
	),
	// Handlers change next, a draft of the new state; tutuca renders it.
	on: {
		inc(next) {
			next.count += 1;
		},
		dec(next) {
			next.count -= 1;
		},
	},
});

// A book of stories: initial states to show, sequences of steps to replay and check.
export default stories({
	title: "Counter",
	components: { Counter },
	stories: {
		"From zero": {
			make: (C) => C.Counter(),
			sequences: {
				"count to three": [
					step.event("click", ".btn-primary"),
					step.event("click", ".btn-primary"),
					step.event("click", ".btn-primary"),
					step.check("shows 3", (s) => s.count === 3),
				],
			},
		},
		"From ten": { make: (C) => C.Counter({ count: 10 }) },
	},
});
