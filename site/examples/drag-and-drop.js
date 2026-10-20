// 6. Drag and drop: draggable="true" makes an element draggable, on:drop makes one a drop
// target. In the drop's send, dragKey() is the key of the dragged item and sourceKey() the
// one it was dropped on. While dragging, tutuca marks the dragged element with data-dragging
// and the target under it with data-draggingover, set to the dragged one's data-dragtype.
import {
	component,
	dragKey,
	each,
	field,
	lookupBind,
	send,
	sourceKey,
	t,
	tag,
	targetValue,
} from "tutuca";
import { step, stories } from "tutuca/storybook";

const { div, input, li, ul } = tag;

// Whether the drop landed on the lower half of the element that handles it; a move sent
// without an event, as tests do, goes before.
const isLowerHalf = ({ event, node }) => {
	if (node === null || typeof event?.clientY !== "number") return false;
	const rect = node.getBoundingClientRect();
	return event.clientY > rect.top + rect.height / 2;
};

export const Planets = component({
	name: "Planets",
	fields: {
		query: t.string(),
		items: t.array(t.string()),
	},
	loops: {
		matching: {
			filter(_key, item) {
				return item.toLowerCase().includes(this.query.toLowerCase());
			},
		},
	},
	view: div(
		{ class: "flex max-w-xs flex-col gap-3" },
		input({
			type: "search",
			class: "input",
			placeholder: "Filter",
			value: field("query"),
			"on:input": send("setQuery", targetValue()),
		}),
		ul(
			{ class: "flex flex-col gap-1" },
			each(
				field("items"),
				li(
					{
						class:
							"cursor-grab rounded-box border border-base-300 px-3 py-2 data-[dragging]:opacity-40 data-[draggingover=planet]:border-primary",
						draggable: "true",
						"data-dragtype": "planet",
						"on:drop": send("move", dragKey(), sourceKey()),
					},
					lookupBind("value"),
				),
				"matching",
			),
		),
	),
	on: {
		setQuery(draft, [query]) {
			draft.query = query;
		},
		// from is null when what was dropped didn't come from this list.
		move: {
			args: [t.option(t.index("items")), t.index("items")],
			run(draft, [from, to], ctx) {
				if (from === null || from === to) return;
				const [item] = draft.items.splice(from, 1);
				const at = from < to ? to - 1 : to;
				draft.items.splice(at + (isLowerHalf(ctx) ? 1 : 0), 0, item);
			},
		},
	},
});

const PLANETS = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn"];

export default stories({
	title: "Planets",
	components: { Planets },
	stories: {
		All: {
			make: (C) => C.Planets({ items: PLANETS }),
			sequences: {
				"drop the first on the third": [
					step.drag("li:nth-child(1)", "li:nth-child(3)"),
					step.check("Mercury is now second", (s) => s.items[1] === "Mercury"),
				],
			},
		},
		Filtered: { make: (C) => C.Planets({ items: PLANETS, query: "u" }) },
	},
});
