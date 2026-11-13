// tutuca/llm (experimental): components a model can read and use. A component's
// renders.llmContext says what it tells a model about itself, as markdown made to be put in its
// context, and renders.llmTools the tools it gives it to change it, as its view says what it
// renders on a page. Both are opt in: enableTargets(llmContextTarget, llmToolsTarget), from
// tutuca/llm/target with the tags, which a module that only declares components imports.
//
//   const { Section, Fact, Items, Item } = llmContext;
//   const { Tools, Tool, Str } = llmTools;
//   renders: {
//     llmContext: Section("Todo list", Fact("Left", field("left")),
//       Items(each(field("items"), Item({ done: field("done") }, field("title"))))),
//     llmTools: Tools(
//       Tool("add_task", send("add", toolArg("title")), "Add a task.", Str("title", "What to do")),
//     ),
//   }
//   renderLlmContext(todo)   // "# Todo list\n\n- **Left:** 1\n\n- [ ] Buy milk\n"
//   renderLlmTools(todo)     // [{ name: "add_task", description, input_schema }]
//   callLlmTool(host, { name: "add_task", input: { title: "Write docs" } })
//
// Both have When, Unless and Choose, so what's told and what can be done follow the state: a
// tool that can't be used now isn't offered, an Enum's values are the ones there are, a hint
// says what to do next. field, each, render and pushView work as in views: a component renders
// its child components' llmContext and llmTools among its own.
//
// What a tag says is checked when it's built (build.js, against the tables in context.js and
// tools.js) and what it renders when it renders, each issue at its path, as one LlmError.
// callLlmTool checks a call's input against its tool's schema and throws a ToolCallError whose
// issues are what to tell the model.
export { LlmError } from "./build.js";
export { COMPARISONS, present } from "./cond.js";
export { CONTEXT } from "./context.js";
export {
	formatValue,
	lowerContext,
	renderLlmContext,
	renderLlmContextAst,
} from "./context-render.js";
export {
	Case,
	Choose,
	llmContext,
	llmContextTarget,
	llmTools,
	llmToolsTarget,
	Otherwise,
	toolArg,
	Unless,
	When,
} from "./target.js";
export { TOOLS } from "./tools.js";
export {
	callLlmTool,
	inputIssues,
	lowerTools,
	renderLlmTools,
	ToolCallError,
} from "./tools-render.js";
