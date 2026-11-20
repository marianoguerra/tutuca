// The media module: views that aren't only HTML. Dot draws in SVG, Sum writes a formula in
// MathML, Rating holds a custom element (tw-rating, rating.js next to this file).
import type { Display } from "../meta/meta.tutuca";
import {
	button,
	circle,
	div,
	eventProperty,
	field,
	g,
	h,
	math,
	mfrac,
	mi,
	mn,
	mo,
	mrow,
	munderover,
	p,
	rect,
	send,
	span,
	svg,
	text,
	when,
} from "tutuca/view";

/** An SVG circle: click it to fill it, click − or + (SVG shapes too) to resize it. */
export type Dot = { r: number; filled: boolean };
export const Dot = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Dot", icon: "⚪", description: "An SVG circle to fill and resize." },
	},
	defaults: { r: 20, filled: false },
	constraints: { r: { int: true, min: 10, max: 40 } },
	on: {
		/** Five at a time, kept within 10 and 40. */
		grow: {
			pure: true,
			changes: ["r"],
			post(prev, next, []: []) {
				return next.r >= prev.r;
			},
			run(next, []: []) {
				next.r = Math.min(this.r + 5, 40);
			},
		},
		shrink: {
			pure: true,
			changes: ["r"],
			post(prev, next, []: []) {
				return next.r <= prev.r;
			},
			run(next, []: []) {
				next.r = Math.max(this.r - 5, 10);
			},
		},
		toggle: {
			pure: true,
			changes: ["filled"],
			post(prev, next, []: []) {
				return next.filled === !prev.filled;
			},
			run(next, []: []) {
				next.filled = !this.filled;
			},
		},
	},
	view: div(
		{ class: "flex flex-col items-center gap-2" },
		svg(
			{ viewBox: "0 0 100 100", width: "160", height: "160", class: "text-primary select-none" },
			circle({
				cx: "50",
				cy: "45",
				r: field("r"),
				stroke: "currentColor",
				"stroke-width": "2",
				fill: when(field("filled"), "currentColor", "transparent"),
				class: "cursor-pointer",
				"on:click": send("toggle"),
			}),
			g(
				{ class: "cursor-pointer", "on:click": send("shrink") },
				rect({ x: "2", y: "82", width: "16", height: "16", rx: "3", fill: "currentColor", "fill-opacity": "0.2" }),
				text({ x: "10", y: "94", "text-anchor": "middle", "font-size": "12", fill: "currentColor" }, "−"),
			),
			g(
				{ class: "cursor-pointer", "on:click": send("grow") },
				rect({ x: "82", y: "82", width: "16", height: "16", rx: "3", fill: "currentColor", "fill-opacity": "0.2" }),
				text({ x: "90", y: "94", "text-anchor": "middle", "font-size": "12", fill: "currentColor" }, "+"),
			),
		),
		p({ class: "text-sm opacity-70" }, "r = ", field("r"), when(field("filled"), ", filled", ", outlined")),
	),
	examples: {
		togglesAndResizes: {
			start: { r: 20, filled: false },
			steps: [
				{ send: "toggle" },
				{ expect: { filled: true } },
				{ send: "grow" },
				{ expect: { r: 25 } },
				{ send: "shrink" },
				{ send: "shrink" },
				{ expect: { r: 15 } },
			],
		},
	},
};

/** The sum of 1 to n in MathML, its closed form with n put in, and its value: click the formula,
 * or +, for one more term. */
export type Sum = { n: number; readonly total: number };
export const Sum = {
	meta: {
		"https://tutuca.dev/meta/display": {
			title: "Sum",
			icon: "∑",
			description: "The sum of 1 to n in MathML, and its closed form.",
		},
	},
	defaults: { n: 3 },
	constraints: { n: { int: true, min: 1, max: 20 } },
	queries: {
		get total(): number {
			return (this.n * (this.n + 1)) / 2;
		},
	},
	on: {
		/** One more term, up to 20. */
		inc: {
			pure: true,
			changes: ["n"],
			post(prev, next, []: []) {
				return next.n >= prev.n;
			},
			run(next, []: []) {
				if (this.n < 20) next.n = this.n + 1;
			},
		},
		dec: {
			pure: true,
			changes: ["n"],
			post(prev, next, []: []) {
				return next.n <= prev.n;
			},
			run(next, []: []) {
				if (this.n > 1) next.n = this.n - 1;
			},
		},
	},
	view: div(
		{ class: "flex items-center gap-3" },
		button({ class: "btn btn-sm", "on:click": send("dec") }, "−"),
		math(
			{ display: "block", class: "text-2xl cursor-pointer", "on:click": send("inc") },
			munderover({}, mo({}, "∑"), mrow({}, mi({}, "i"), mo({}, "="), mn({}, "1")), mn({}, field("n"))),
			mi({}, "i"),
			mo({}, "="),
			mfrac(
				{},
				mrow({}, mn({}, field("n")), mo({}, "("), mn({}, field("n")), mo({}, "+"), mn({}, "1"), mo({}, ")")),
				mn({}, "2"),
			),
			mo({}, "="),
			mn({}, field("total")),
		),
		button({ class: "btn btn-sm", "on:click": send("inc") }, "+"),
	),
	examples: {
		sums: { start: { n: 3 }, steps: [{ send: "inc" }, { expect: { n: 4 } }] },
	},
};

/** Stars from a custom element: tw-rating shows them in its shadow root and fires rating-change,
 * a CustomEvent whose detail is the stars clicked; it shows what its stars property says, which
 * comes from here. */
export type Rating = { stars: number };
export const Rating = {
	meta: {
		"https://tutuca.dev/meta/display": { title: "Rating", icon: "⭐", description: "Stars from a custom element." },
	},
	defaults: { stars: 0 },
	constraints: { stars: { int: true, min: 0, max: 5 } },
	on: {
		/** n is tw-rating's event detail, within 0 and 5: the runtime rejects the rest. */
		rate: {
			pure: true,
			changes: ["stars"],
			constraints: { n: { int: true, min: 0, max: 5 } },
			post(prev, next, [n]: [number]) {
				return next.stars === n;
			},
			run(next, [n]: [number]) {
				next.stars = n;
			},
		},
		clear: {
			pure: true,
			changes: ["stars"],
			post(prev, next, []: []) {
				return next.stars === 0;
			},
			run(next, []: []) {
				next.stars = 0;
			},
		},
	},
	view: div(
		{ class: "flex items-center gap-3" },
		h("tw-rating", { stars: field("stars"), "on:rating-change": send("rate", eventProperty("detail")) }),
		span({ class: "text-sm opacity-70 tabular-nums" }, field("stars"), " of 5"),
		button({ class: "btn btn-sm btn-ghost", "on:click": send("clear") }, "clear"),
	),
	examples: {
		rates: {
			start: { stars: 0 },
			steps: [{ send: "rate", args: [4] }, { expect: { stars: 4 } }, { send: "clear" }, { expect: { stars: 0 } }],
		},
	},
};

export const register = { Dot: "Dot", Sum: "Sum", Rating: "Rating" };
