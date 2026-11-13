// 1. A counter: a component is a name, typed fields, a view and the messages it handles.
// Click the buttons in Preview, then open Steps to replay the "count to three" sequence.
// Its renders are what it is elsewhere: tui in a terminal (`node scripts/tui.js counter`), js
// the code that makes it, md a description of it, llmContext what a model is told about it and
// llmTools what a model can do to it (the Renders demo shows them).
import { $if, component, enableTargets, field, send, t, tag } from "tutuca";
import { js, jsTarget } from "tutuca/jsast/target";
import {
	Case,
	Choose,
	llmContext,
	llmContextTarget,
	llmTools,
	llmToolsTarget,
	Unless,
} from "tutuca/llm/target";
import { md, mdTarget } from "tutuca/mdast/target";
import { book, step } from "tutuca/storybook";
import { tuiTarget } from "tutuca/tui/target";

// What it renders besides views is opt in, a target at a time.
enableTargets(tuiTarget, jsTarget, mdTarget, llmContextTarget, llmToolsTarget);

const { box, button, div, span, text } = tag;
const { ExpressionStatement, Identifier, Literal, NewExpression, UnaryExpression } = js;
const { argument, arguments: args, callee, expression } = js;
const { Paragraph, Strong } = md;
const { Fact, Hint, Section, Text } = llmContext;
const { Tool, Tools } = llmTools;

export const Counter = component({
	name: "Counter",
	// Fields are schemas: count is a number that starts at 0.
	fields: { count: t.number() },
	// A negative number in JavaScript is a minus before a positive literal.
	queries: {
		get isNegative() {
			return this.count < 0;
		},
		get magnitude() {
			return Math.abs(this.count);
		},
	},
	// The view is data: send("inc") is the message a click sends to this component.
	view: div(
		{ class: "flex items-center gap-3" },
		button({ class: "btn", "on:click": send("dec") }, "−"),
		span({ class: "text-2xl font-bold tabular-nums" }, field("count")),
		button({ class: "btn btn-primary", "on:click": send("inc") }, "+"),
	),
	// The same messages from a terminal: boxes instead of buttons, clicked or focused with Tab
	// and pressed with Enter.
	renders: {
		tui: box(
			{ flexDirection: "row", gap: "1", alignItems: "center" },
			box({ borderStyle: "round", paddingX: "1", focusable: "true", "on:click": send("dec") }, "−"),
			text({ bold: "true", color: "cyan" }, field("count")),
			box({ borderStyle: "round", paddingX: "1", focusable: "true", "on:click": send("inc") }, "+"),
		),
		// new Counter(3);
		js: ExpressionStatement(
			expression(
				NewExpression(
					callee(Identifier({ name: "Counter" })),
					args(
						$if(
							field("isNegative"),
							UnaryExpression({ operator: "-" }, argument(Literal({ value: field("magnitude") }))),
							Literal({ value: field("count") }),
						),
					),
				),
			),
		),
		// Count: **3**
		md: Paragraph("Count: ", Strong(field("count"))),
		// What a model is told: the count, and what it means, by its sign.
		llmContext: Section(
			"Counter",
			Fact("Count", field("count")),
			Choose(
				Case({ test: field("count"), is: 0 }, Text("It's where it starts.")),
				Case(field("isNegative"), Hint("It's below zero; increment brings it back.")),
			),
		),
		// What a model can do: reset is offered only when there's something to reset.
		llmTools: Tools(
			Tool("increment", send("inc"), "Add one to the count."),
			Tool("decrement", send("dec"), "Take one from the count."),
			Unless({ test: field("count"), is: 0 }, Tool("reset", send("reset"), "Set the count to 0.")),
		),
	},
	// Handlers change next, a draft of the new state; tutuca renders it.
	on: {
		inc(next) {
			next.count += 1;
		},
		dec(next) {
			next.count -= 1;
		},
		reset(next) {
			next.count = 0;
		},
	},
});

// A book of stories: initial states to show, sequences of steps to replay and check.
export default book({
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
