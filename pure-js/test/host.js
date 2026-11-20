// The host and fixtures the conformance suite runs against: the standard host and a few
// records, a union, a dictionary and a handle, the shapes handlers have. A case says its
// signature in its header (see cases.js).

import { stdHost } from "../lib/index.js";

export const host = stdHost.extend({
	types: {
		Item: "{ title: string; done: boolean }",
		TodoList: `{
			text: string;
			count: number;
			items: Item[];
			filter: "all" | "open" | "done";
			selected: Item | null;
			tags: { [key: string]: number };
			readonly left: number;
		}`,
		Circle: '{ kind: "circle"; r: number }',
		Square: '{ kind: "square"; side: number }',
		Shape: "Circle | Square",
		Drawing: "{ shapes: Shape[]; current: Shape | null; total: number; label: string }",
	},
	handles: {
		Ctx: `{
			readonly sourceKey: unknown;
			notify(name: "changed" | "saved", args: unknown[]): void;
			uuid(): string;
		}`,
	},
	nondeterministic: ["Ctx.uuid"],
});

const todo = () => ({
	text: " Buy milk ",
	count: 2,
	items: [
		{ title: "write docs", done: true },
		{ title: "ship", done: false },
	],
	filter: "all",
	selected: null,
	tags: { urgent: 1 },
	left: 1,
});
const drawing = () => ({
	shapes: [
		{ kind: "circle", r: 2 },
		{ kind: "square", side: 3 },
	],
	current: null,
	total: 0,
	label: "",
});
const deepFreeze = (v) => {
	if (v !== null && typeof v === "object") {
		for (const x of Object.values(v)) deepFreeze(x);
		Object.freeze(v);
	}
	return v;
};

// The values a case's @run names: @todo and @drawing are frozen (this), @draft-todo and
// @draft-drawing mutable copies (the draft), @ctx a handle that records what it is asked.
export const fixtures = () => {
	const calls = [];
	const ctx = {
		sourceKey: 0,
		notify: (name, args) => calls.push(["notify", name, args]),
		uuid: () => "uuid-1",
	};
	return {
		values: {
			"@todo": deepFreeze(todo()),
			"@drawing": deepFreeze(drawing()),
			"@draft-todo": todo(),
			"@draft-drawing": drawing(),
			"@ctx": ctx,
		},
		calls,
	};
};

// The host module cases run against: the conformance host, and a module offered by specifier
// (import { upper } from "app/text").
export const moduleHost = host.extend(
	{
		modules: {
			Text: { upper: "(text: string) => string", repeat: "(text: string, n: number) => string" },
		},
		imports: { "app/text": "Text" },
	},
	{
		"Text.upper": (t) => t.toUpperCase(),
		"Text.repeat": (t, n) => t.repeat(Math.max(0, Math.min(n, 100))),
	},
);
