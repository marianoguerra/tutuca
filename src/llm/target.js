// tutuca/llm/target: what a component that renders for a model needs to be declared, without the
// renderers: llmToolsTarget and llmContextTarget, to pass to enableTargets before component()
// takes a renders.llmTools or renders.llmContext, and the tags they're written with (llmTools,
// llmContext, toolArg, and the conditionals both have). tutuca/llm renders them.
import { RenderTarget } from "../core/model/targets.js";

export const llmToolsTarget = new RenderTarget("llmTools");
export const llmContextTarget = new RenderTarget("llmContext");
export { LlmError } from "./build.js";
export { Case, Choose, Otherwise, Unless, When } from "./cond.js";
export { llmContext } from "./context.js";
export { llmTools, toolArg } from "./tools.js";
