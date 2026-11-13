// llmTools: the tag builders of renders.llmTools, the tools a model is given to change a
// component, as tag is of views. A Tool is a tool's name, the send its call makes, a description
// (its text) and its params; its call goes to the component it was rendered in, as a click on
// the page does to the element's:
//
//   const { Tools, Tool, Str, Enum, Option } = llmTools;
//   Tools(
//     Tool("add_task", send("add", toolArg("title")), "Add a task.", Str("title", "What to do")),
//     When(field("items"),
//       Tool("toggle_task", send("toggle", toolArg("index")), "Mark a task done or not done.",
//         Enum("index", "Which task.", each(field("items"), Option(lookupBind("key"), field("title"))))),
//     ),
//   )
//
// toolArg(name) is the value of the call's param name. Params are required unless optional;
// Enum's values are its Options (or values), List's items its one param. When, Unless and Choose
// (cond.js) say which tools there are, and what they take, by the state.
import { EventArgNode, SendNode } from "../tutuca.js";
import { attr, vocabulary } from "./build.js";
import { conditionals } from "./cond.js";

export const PARAMS = ["Str", "Num", "Int", "Bool", "Enum", "List"];
const name = attr("string");
const optional = attr("boolean");
const num = attr("number");
const param = (attrs, more = {}) => ({
	positional: ["name"],
	attrs: { name, optional, ...attrs },
	text: true,
	...more,
});

// A Tool's params have names, a List's item doesn't.
const paramNames = (owner, named) => (_attrs, _node, statics, issues) => {
	for (const child of statics.elements) {
		const hasName = child.attrs.some(([n]) => n === "name");
		if (named && !hasName) issues.push(`${owner}'s ${child.tagName} needs a name`);
		if (!named && hasName) issues.push(`${owner}'s item is a ${child.tagName} without a name`);
	}
};

export const TOOLS = {
	Tools: { children: ["Tools", "Tool"] },
	Tool: {
		positional: ["name", "on:call"],
		attrs: { name: attr("string", true) },
		handler: "call",
		children: PARAMS,
		text: true,
		check: (attrs, node, statics, issues) => {
			if (node.handlers.length === 0) issues.push(`Tool ${attrs.name} needs an on:call`);
			for (const { action } of node.handlers) {
				if (!(action instanceof SendNode)) {
					issues.push(`Tool ${attrs.name}'s on:call is a send, not ${JSON.stringify(action)}`);
				}
			}
			paramNames("Tool", true)(attrs, node, statics, issues);
		},
	},
	Str: param({ minLength: num, maxLength: num, pattern: attr("string") }),
	Num: param({ min: num, max: num }),
	Int: param({ min: num, max: num }),
	Bool: param({}),
	// The values its Options say, or values.
	Enum: param({ values: attr("any") }, { children: ["Option"] }),
	Option: { positional: ["value"], attrs: { value: attr("any", true) }, text: true },
	List: param(
		{ minItems: num, maxItems: num },
		{
			children: PARAMS,
			check: (attrs, node, statics, issues) => {
				paramNames("List", false)(attrs, node, statics, issues);
				if (statics.elements.length > 1 || (!statics.dynamic && statics.elements.length === 0))
					issues.push("List takes one param, its items'");
			},
		},
	),
};

// The value of the tool call's param name, as targetValue() is of an input's.
export class ToolArgNode extends EventArgNode {
	constructor(param) {
		super("toolArg");
		this.param = param;
	}
	eval(ctx) {
		return ctx.event?.input?.[this.param];
	}
}
export const toolArg = (param) => new ToolArgNode(param);

export const llmTools = vocabulary(TOOLS, conditionals);
