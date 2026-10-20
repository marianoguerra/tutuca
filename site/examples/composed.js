// 3. Components inside components: a cart of line items. Each line is its own component
// with its own messages; the cart renders them and listens to what they notify.
// Messages declare typed args, checked when sent: try sending setQuantity(-1) from Steps.
import { component, field, renderEach, send, t, tag } from "tutuca";
import { step, stories } from "tutuca/storybook";

const { button, div, span, strong } = tag;

export const Line = component({
	name: "Line",
	fields: {
		name: t.string(),
		price: t.number().min(0),
		quantity: t.number(1).int().min(0),
	},
	methods: {
		get subtotal() {
			return (this.price * this.quantity).toFixed(2);
		},
	},
	view: div(
		{ class: "flex items-center gap-3 rounded-box bg-base-200 p-2" },
		span({ class: "flex-1" }, field("name")),
		div(
			{ class: "join" },
			button({ class: "btn btn-sm join-item", "on:click": send("step", -1) }, "−"),
			span({ class: "btn btn-sm join-item pointer-events-none tabular-nums" }, field("quantity")),
			button({ class: "btn btn-sm join-item", "on:click": send("step", 1) }, "+"),
		),
		span({ class: "w-16 text-right tabular-nums" }, "$", field("subtotal")),
		button({ class: "btn btn-sm btn-ghost", "on:click": send("remove") }, "✕"),
	),
	on: {
		step: {
			args: [t.number().int()],
			run(draft, [by]) {
				draft.quantity = Math.max(0, this.quantity + by);
			},
		},
		setQuantity: {
			args: [t.number().int().min(0)],
			run(draft, [quantity]) {
				draft.quantity = quantity;
			},
		},
		// A line can't remove itself: it tells its parent, which owns the list.
		remove: {
			args: [],
			emits: { notify: ["removeLine"] },
			run(_draft, _args, ctx) {
				ctx.notify("removeLine");
			},
		},
	},
});

export const Cart = component({
	name: "Cart",
	fields: { lines: t.array(t.component("Line")) },
	methods: {
		get total() {
			return this.lines.reduce((sum, line) => sum + line.price * line.quantity, 0).toFixed(2);
		},
		get count() {
			return this.lines.reduce((sum, line) => sum + line.quantity, 0);
		},
	},
	view: div(
		{ class: "flex max-w-md flex-col gap-2" },
		// Each line renders with its own view and handles its own messages.
		renderEach(field("lines")),
		div(
			{ class: "flex justify-between border-t border-base-300 pt-2" },
			span({}, field("count"), " items"),
			strong({}, "Total $", field("total")),
		),
	),
	on: {
		// sourceKey is the index of the line the notification came from.
		removeLine: {
			args: [],
			sourceKey: t.index("lines"),
			run(draft, _args, ctx) {
				draft.lines.splice(ctx.sourceKey, 1);
				ctx.stopNext();
			},
		},
	},
});

const sample = (C) =>
	C.Cart({
		lines: [
			C.Line({ name: "Coffee beans", price: 12.5, quantity: 2 }),
			C.Line({ name: "Filters", price: 3 }),
			C.Line({ name: "Mug", price: 9.75 }),
		],
	});

export default stories({
	title: "Cart",
	components: { Cart, Line },
	stories: {
		"Three lines": {
			make: sample,
			sequences: {
				"change and remove": [
					step.send("step", [1], { at: (b) => b.item("lines", 1) }),
					step.check("two filters", (s) => s.lines[1].quantity === 2),
					step.event("click", ".btn-ghost"),
					step.check("coffee is gone", (s) => s.lines.length === 2 && s.total === "15.75"),
				],
			},
			pbt: { maxCommands: 10 },
		},
		Empty: { make: (C) => C.Cart() },
	},
});
