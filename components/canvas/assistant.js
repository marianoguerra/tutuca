// The canvas's agent (index.js): what it's told, what its tools are, and the queries it reads
// the canvas with, by item key.
import { agentOf, agentTool, hasAgentMeta, specOf, summaryOf, t } from "../../src/tutuca.js";

// What the canvas's agent is told, and can do: by item key.
export const ASSISTANT = {
	prompt: `A canvas of components, each an item with a key. To work toward what you're asked:
list_kinds says what you can add (and which can have an agent of their own); add_component adds
one (x, y null puts it after the others; choice picks a sample or a choice, null for none);
enable_agent gives an item an agent of its own, which knows its component; delegate prompts that
agent with a self-contained task and answers once it's done, with what it said; item_summary and
item_tools say what an item is and what its agent can do, to prompt it well; eject_agent takes
the agent away, leaving the component as its agent left it, once it's done. Delegate one task at
a time, check the result, and eject the agents when you're finished. Place items so they don't
overlap: each is as wide as it says.`,
	summary: "summary",
	maxSteps: 40,
	tools: [
		agentTool("list_kinds", "query", [], "The kinds of component you can add, as JSON.", {
			target: "kinds_list",
		}),
		agentTool(
			"add_component",
			"message",
			["kind", "choice", "x", "y"],
			"Add a component of a kind.",
			{
				result: "added_result",
			},
		),
		agentTool("move_item", "message", ["key", "x", "y"], "Move an item."),
		agentTool(
			"resize_item",
			"message",
			["key", "width", "height"],
			"Resize an item; height 0 is as tall as its content.",
		),
		agentTool(
			"set_title",
			"message",
			["key", "title"],
			"Title an item; empty, it says what it holds.",
		),
		agentTool("remove_item", "message", ["key"], "Remove an item."),
		agentTool("enable_agent", "message", ["key"], "Give an item's component an agent of its own."),
		agentTool(
			"delegate",
			"message",
			["key", "prompt"],
			"Prompt an item's agent; answers when it's done.",
			{
				result: "delegated_result",
			},
		),
		agentTool(
			"eject_agent",
			"message",
			["key"],
			"Take an item's agent away, keeping its component.",
		),
		agentTool("item_summary", "query", ["key"], "What an item's component is now."),
		agentTool("item_tools", "query", ["key"], "What an item's component's agent can do."),
	],
};
// The component an item holds, the one its agent drives if it has one; null without an item.
export const targetOf = (item) => {
	if (item === undefined) return null;
	return item.isWrapped ? item.content.target : item.content;
};
// The item's agent uses the model the canvas's agent does (sent after what wraps it, if that's
// on its way: the queue is FIFO).
export const passModel = (self, ctx, key) => {
	if (self.agentModel === "") return;
	ctx.sendAt("useModel", [self.agentModel], (s) => s.item("items", key).field("content"));
};
export const agentBusy = (item) => item?.isWrapped === true && item.content.isBusy;
// An item's line in the summary: key, label, where, how big, and its agent.
export const itemLine = (key, item) => {
	const title = item.title || item.label;
	const size = `${item.width}×${item.height || "auto"}`;
	const can = hasAgentMeta(targetOf(item));
	const agent = item.isWrapped
		? `agent ${item.content.isBusy ? "busy" : "enabled"}`
		: can
			? "can have an agent"
			: "no agent";
	return `${key} "${title}" (${specOf(targetOf(item)).name}) at ${item.x},${item.y} ${size}, ${agent}`;
};

// What the canvas's agent reads it with: merge them into its queries with mix, getters kept.
export const assistantQueries = {
	// For its agent: a line per item, by key, then the kinds it can add.
	get summary() {
		const lines = [`Canvas ${this.width}×${this.height}.`];
		if (this.order.length === 0) lines.push("No items.");
		for (const key of this.order) lines.push(itemLine(key, this.items[key]));
		const kinds = this.kinds.map((k) => k.id).join(", ");
		lines.push(kinds === "" ? "No kinds known." : `Kinds you can add: ${kinds}.`);
		return lines.join("\n");
	},
	get kinds_list() {
		// choices: what its choice can be, its own or its samples (null for none).
		return this.kinds.map(({ id, label, blurb, agent, choices, samples }) => ({
			id,
			label,
			blurb,
			agent: agent === true,
			choices: [...(choices ?? []), ...(samples ?? [])].map((c) => c.id),
		}));
	},
	// What add_component answers: the item it added, or why it couldn't, and the canvas.
	get added_result() {
		const what = this.problem !== "" ? `Couldn't add it: ${this.problem}` : `Added ${this.added}.`;
		return `${what}\n${this.summary}`;
	},
	// What delegate answers: what the item's agent said last, and what its component is now.
	get delegated_result() {
		const item = this.items[this.delegated];
		if (item === undefined) return `There's no item ${this.delegated}.`;
		const said = item.content.lastAnswer ?? "";
		return `Its agent said: ${said || "(nothing)"}\nNow: ${summaryOf(item.content.target)}`;
	},
	item_summary: {
		args: [t.string()],
		run(key) {
			const target = targetOf(this.items[key]);
			if (target === null) return `There's no item ${key}.`;
			return summaryOf(target);
		},
	},
	item_tools: {
		args: [t.string()],
		run(key) {
			const target = targetOf(this.items[key]);
			if (target === null) return `There's no item ${key}.`;
			return agentOf(target).tools.map(({ name, kind, params, description }) => ({
				name,
				kind,
				params,
				description,
			}));
		},
	},
};
