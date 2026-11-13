// llmContext: the tag builders of renders.llmContext, what a model is told about a component
// when it's put in its context, as tag is of views. It's markdown (tutuca/mdast prints it), in
// a few nodes made for that:
//
//   const { Section, Fact, Items, Item, Hint, Data } = llmContext;
//   Section("Todo list",
//     Fact("Left", field("left")),
//     Items({ max: 10, empty: "No tasks." },
//       each(field("items"), Item({ done: field("done") }, field("title")))),
//     When({ test: field("left"), is: 0 }, Hint("Everything is done.")),
//   )
//
// Section is a heading and what's under it; a child component's Section is a level deeper.
// Facts next to each other are one list, "- **Left:** 2", a value printed for reading (true is
// yes, an array its items, none for nothing). Items is a list, a task list when its Items say
// done; past max it says how many more there are, and empty is what it says without any. Hint is
// guidance for the model, Text a paragraph, Data a value as a JSON block. Strong, Em and Code
// mark inline text. When, Unless and Choose (cond.js) say what's told by the state.
import { attr, vocabulary } from "./build.js";
import { conditionals } from "./cond.js";

export const FLOW = ["Section", "Text", "Hint", "Fact", "Items", "Data"];
export const INLINE = ["Strong", "Em", "Code"];
const inline = { children: INLINE, text: true };

export const CONTEXT = {
	Section: { positional: ["title"], attrs: { title: attr("string", true) }, children: FLOW },
	Text: inline,
	Hint: inline,
	Fact: {
		positional: ["name", "value"],
		attrs: { name: attr("string", true), value: attr("any") },
		...inline,
	},
	Items: { attrs: { max: attr("number"), empty: attr("string") }, children: ["Item"] },
	Item: { attrs: { done: attr("boolean") }, children: [...INLINE, "Items"], text: true },
	Data: { positional: ["value"], attrs: { value: attr("any"), lang: attr("string") } },
	Strong: inline,
	Em: inline,
	Code: { text: true },
};

export const llmContext = vocabulary(CONTEXT, conditionals);
