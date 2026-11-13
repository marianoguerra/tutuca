// 3. Components inside components: a cart of line items. Each line is its own component
// with its own messages; the cart renders them and listens to what they notify.
// Messages declare typed args, checked when sent: try sending setQuantity(-1) from Steps.
// Its other renders nest too: the cart's tui, js, md, ps (an invoice, printed as PostScript and
// PDF), docx, llmContext and llmTools render each line's
// where it puts them, and a line's tools are the cart's, called on that line (the Renders demo
// shows them).
import { $if, component, enableTargets, field, renderEach, send, t, tag } from "tutuca";
import { docx, docxTarget } from "tutuca/docx/target";
import { js, jsTarget } from "tutuca/jsast/target";
import {
	llmContext,
	llmContextTarget,
	llmTools,
	llmToolsTarget,
	toolArg,
	When,
} from "tutuca/llm/target";
import { md, mdTarget } from "tutuca/mdast/target";
import { ps, psTarget } from "tutuca/ps/target";
import { book, step } from "tutuca/storybook";
import { tuiTarget } from "tutuca/tui/target";

enableTargets(
	tuiTarget,
	jsTarget,
	mdTarget,
	psTarget,
	docxTarget,
	llmContextTarget,
	llmToolsTarget,
);

// The invoice's columns: where the item starts, and where the quantity, price and subtotal end.
const COLUMNS = { item: 0, qty: 250, price: 330, subtotal: 420 };

const { box, button, div, span, strong, text } = tag;
const { ArrayExpression, CallExpression, Identifier, Literal, MemberExpression } = js;
const { ObjectExpression, Property } = js;
const { arguments: args, callee, elements, key, object, properties, property, value } = js;
const { Paragraph, Root, Strong, Table, TableCell, TableRow } = md;
const { Fact, Hint, Item, Items, Section } = llmContext;
const { Int, Tool, Tools } = llmTools;

// C.Name({ field: value, ... }): the code that makes a component in a state, with a scope's
// components, as a story's make does.
const make = (name, ...props) =>
	CallExpression(
		callee(MemberExpression(object(Identifier({ name: "C" })), property(Identifier({ name })))),
		args(ObjectExpression(properties(...props))),
	);
const prop = (name, node) => Property({ kind: "init" }, key(Identifier({ name })), value(node));
// A field that's a string, a boolean or a number that can't be negative.
const literal = (name) => prop(name, Literal({ value: field(name) }));
// A name as part of a tool's name, which can only have letters, digits, _ and -.
const slug = (name) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_|_$/g, "");

export const Line = component({
	name: "Line",
	fields: {
		name: t.string(),
		price: t.number().min(0),
		quantity: t.number(1).int().min(0),
	},
	queries: {
		get subtotal() {
			return (this.price * this.quantity).toFixed(2);
		},
		get priceText() {
			return this.price.toFixed(2);
		},
		// Each line's tools have its own names: a cart offers them all.
		get quantityTool() {
			return `set_${slug(this.name)}_quantity`;
		},
		get removeTool() {
			return `remove_${slug(this.name)}`;
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
	renders: {
		// A row of the cart's box: Tab focuses − + and ✕, Enter or space presses them.
		tui: box(
			{ flexDirection: "row", gap: "1" },
			text({ flexGrow: "1" }, field("name")),
			box({ focusable: "true", "on:click": send("step", -1) }, "[−]"),
			text({ bold: "true", color: "cyan" }, field("quantity")),
			box({ focusable: "true", "on:click": send("step", 1) }, "[+]"),
			box(
				{ width: "8", flexDirection: "row", justifyContent: "flex-end" },
				text({}, "$", field("subtotal")),
			),
			box({ focusable: "true", color: "red", "on:click": send("remove") }, "✕"),
		),
		// C.Line({ name: "Mug", price: 9.75, quantity: 1 }), in the cart's array.
		js: make("Line", literal("name"), literal("price"), literal("quantity")),
		// A row of the cart's table.
		md: TableRow(
			TableCell(field("name")),
			TableCell(field("quantity")),
			TableCell("$", field("priceText")),
			TableCell("$", field("subtotal")),
		),
		// A row of the cart's invoice, at the y the cart's Group steps it to.
		ps: ps.Group(
			ps.Text({ x: COLUMNS.item, y: 0 }, field("name")),
			ps.Text({ x: COLUMNS.qty, y: 0, align: "right" }, field("quantity")),
			ps.Text({ x: COLUMNS.price, y: 0, align: "right" }, "$", field("priceText")),
			ps.Text({ x: COLUMNS.subtotal, y: 0, align: "right" }, "$", field("subtotal")),
		),
		// A row of the cart's Word table.
		docx: docx.TableRow(
			docx.TableCell(field("name")),
			docx.TableCell(docx.Paragraph({ align: "right" }, field("quantity"))),
			docx.TableCell(docx.Paragraph({ align: "right" }, "$", field("priceText"))),
			docx.TableCell(docx.Paragraph({ align: "right" }, "$", field("subtotal"))),
		),
		// An item of the cart's list.
		llmContext: Item(
			Strong(field("name")),
			": ",
			field("quantity"),
			" × $",
			field("priceText"),
			" = $",
			field("subtotal"),
		),
		// A tool's name can be computed: one per line, and a call goes to this line, as a click
		// on its buttons does. remove notifies the cart, which takes it out.
		llmTools: Tools(
			Tool(
				{ name: field("quantityTool"), "on:call": send("setQuantity", toolArg("quantity")) },
				"Set the quantity of ",
				field("name"),
				" in the cart.",
				Int({ name: "quantity", min: 0 }, "How many; 0 keeps the line."),
			),
			Tool(
				{ name: field("removeTool"), "on:call": send("remove") },
				"Take ",
				field("name"),
				" out of the cart.",
			),
		),
	},
	on: {
		step: {
			args: [t.number().int()],
			run(next, [by]) {
				next.quantity = Math.max(0, this.quantity + by);
			},
		},
		setQuantity: {
			args: [t.number().int().min(0)],
			run(next, [quantity]) {
				next.quantity = quantity;
			},
		},
		// A line can't remove itself: it tells its parent, which owns the list.
		remove: {
			args: [],
			emits: { notify: ["removeLine"] },
			run(_next, _args, ctx) {
				ctx.notify("removeLine");
			},
		},
	},
});

export const Cart = component({
	name: "Cart",
	fields: { lines: t.array(t.component("Line")) },
	queries: {
		get total() {
			return this.lines.reduce((sum, line) => sum + line.price * line.quantity, 0).toFixed(2);
		},
		get count() {
			return this.lines.reduce((sum, line) => sum + line.quantity, 0);
		},
		get isEmpty() {
			return this.lines.length === 0;
		},
		// The invoice's page: a row per line, 20 points apart, and the total under them.
		get pageHeight() {
			return 170 + this.lines.length * 20;
		},
		get totalY() {
			return -(118 + this.lines.length * 20);
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
	// renderEach puts each line's render for the same target where it is: a NewExpression in the
	// array, a row in the table, an item in the list, its tools among the cart's.
	renders: {
		tui: box(
			{ borderStyle: "round", borderText: "Cart", paddingX: "1", width: "56" },
			renderEach(field("lines")),
			box(
				{ flexDirection: "row", justifyContent: "space-between" },
				text({ dim: "true" }, field("count"), " items"),
				text({ bold: "true" }, "Total $", field("total")),
			),
		),
		// C.Cart({ lines: [C.Line({ ... }), ...] }): each line's code in the array.
		js: make("Cart", prop("lines", ArrayExpression(elements(renderEach(field("lines")))))),
		md: Root(
			$if(
				field("isEmpty"),
				Paragraph("The cart is empty."),
				Table(
					{ align: ["left", "right", "right", "right"] },
					TableRow(TableCell("Item"), TableCell("Qty"), TableCell("Price"), TableCell("Subtotal")),
					renderEach(field("lines")),
					TableRow(
						TableCell(Strong("Total")),
						TableCell(field("count")),
						TableCell(""),
						TableCell(Strong("$", field("total"))),
					),
				),
			),
		),
		// An invoice: a header, each line's row, a rule and the total.
		ps: ps.Page(
			{ width: 480, height: field("pageHeight") },
			ps.Group(
				{ x: 30, y: field("pageHeight") },
				ps.Text({ x: 0, y: -50, size: 20, font: "Helvetica-Bold" }, "Invoice"),
				$if(
					field("isEmpty"),
					ps.Text({ x: 0, y: -90, fill: "#666666" }, "The cart is empty."),
					ps.Group(
						ps.Group(
							{ y: -82 },
							ps.Text({ x: COLUMNS.item, y: 0, size: 9, fill: "#666666" }, "ITEM"),
							ps.Text({ x: COLUMNS.qty, y: 0, size: 9, fill: "#666666", align: "right" }, "QTY"),
							ps.Text(
								{ x: COLUMNS.price, y: 0, size: 9, fill: "#666666", align: "right" },
								"PRICE",
							),
							ps.Text(
								{ x: COLUMNS.subtotal, y: 0, size: 9, fill: "#666666", align: "right" },
								"SUBTOTAL",
							),
						),
						ps.Line({
							x1: 0,
							y1: -88,
							x2: COLUMNS.subtotal,
							y2: -88,
							stroke: "#999999",
							lineWidth: 0.5,
						}),
						ps.Group({ y: -106, stepY: -20 }, renderEach(field("lines"))),
					),
				),
				ps.Group(
					{ y: field("totalY") },
					ps.Line({ x1: 0, y1: 14, x2: COLUMNS.subtotal, y2: 14, stroke: "#333333" }),
					ps.Text({ x: COLUMNS.item, y: 0, font: "Helvetica-Bold" }, field("count"), " items"),
					ps.Text(
						{ x: COLUMNS.subtotal, y: 0, font: "Helvetica-Bold", align: "right" },
						"Total $",
						field("total"),
					),
				),
			),
		),
		// A Word table: a header row, each line's and the total's.
		docx: docx.Section(
			docx.Heading({ level: 1 }, "Cart"),
			$if(
				field("isEmpty"),
				docx.Paragraph("The cart is empty."),
				docx.Table(
					docx.TableRow(
						{ header: true },
						docx.TableCell({ fill: "#eeeeee" }, docx.Strong("Item")),
						docx.TableCell({ fill: "#eeeeee" }, docx.Strong("Qty")),
						docx.TableCell({ fill: "#eeeeee" }, docx.Strong("Price")),
						docx.TableCell({ fill: "#eeeeee" }, docx.Strong("Subtotal")),
					),
					renderEach(field("lines")),
					docx.TableRow(
						docx.TableCell(docx.Strong("Total")),
						docx.TableCell(docx.Paragraph({ align: "right" }, field("count"))),
						docx.TableCell(),
						docx.TableCell(docx.Paragraph({ align: "right" }, docx.Strong("$", field("total")))),
					),
				),
			),
		),
		llmContext: Section(
			"Cart",
			Fact("Items", field("count")),
			Fact("Total", "$", field("total")),
			Items({ empty: "The cart is empty." }, renderEach(field("lines"))),
			When(field("isEmpty"), Hint("There's nothing to change: the cart has no lines.")),
		),
		// The cart has no tools of its own: its lines' are its.
		llmTools: Tools(renderEach(field("lines"))),
	},
	on: {
		// sourceKey is the index of the line the notification came from.
		removeLine: {
			args: [],
			sourceKey: t.index("lines"),
			run(next, _args, ctx) {
				next.lines.splice(ctx.sourceKey, 1);
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

export default book({
	title: "Cart",
	components: { Cart, Line },
	stories: {
		"Three lines": {
			make: sample,
			sequences: {
				"change and remove": [
					step.send("step", [1], { to: (b) => b.item("lines", 1) }),
					step.check("two filters", (s) => s.lines[1].quantity === 2),
					step.event("click", ".btn-ghost"),
					step.check("coffee is gone", (s) => s.lines.length === 2 && s.total === "15.75"),
				],
			},
			stress: { maxCommands: 10 },
		},
		Empty: { make: (C) => C.Cart() },
	},
});
