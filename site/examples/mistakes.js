// 7. When things go wrong. This component has three mistakes the linter catches before
// anything runs: open the Dev tab to see them, with where each one is. Then fix them here
// and press Ctrl+Enter. Sending a message with args of the wrong type is caught when it
// happens: Steps shows it as a problem.
import { component, field, send, t, tag } from "tutuca";
import { step, stories } from "tutuca/storybook";

const { button, div, h3, p } = tag;

export const Greeting = component({
	name: "Greeting",
	fields: (t) => ({ name: t.string("World"), greetings: t.number().int().min(0) }),
	view: div(
		{ class: "flex flex-col gap-2" },
		// Mistake 1: the field is name, not nmae.
		h3({ class: "text-xl" }, "Hello, ", field("nmae"), "!"),
		p({}, "Greeted ", field("greetings"), " times."),
		div(
			{ class: "flex gap-2" },
			button({ class: "btn btn-primary", "@on.click": send("greet") }, "Greet"),
			// Mistake 2: rename takes one string, this sends none.
			button({ class: "btn", "@on.click": send("rename") }, "Rename"),
			// Mistake 3: there is no reset handler.
			button({ class: "btn btn-ghost", "@on.click": send("reset") }, "Reset"),
		),
	),
	on: {
		greet(draft) {
			draft.greetings += 1;
		},
		rename: {
			args: [t.string()],
			run(draft, [name]) {
				draft.name = name;
			},
		},
	},
});

export default stories({
	title: "Mistakes",
	components: { Greeting },
	stories: {
		Greeting: {
			make: (C) => C.Greeting(),
			sequences: {
				"greet twice": [
					step.event("click", ".btn-primary"),
					step.event("click", ".btn-primary"),
					step.check("greeted twice", (s) => s.greetings === 2),
				],
				"a number is not a name": [step.send("rename", [42])],
			},
		},
	},
});
