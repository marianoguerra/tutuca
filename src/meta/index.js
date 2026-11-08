// The meta conventions, built on the core's meta (metaOf, a scope's meta schemas) and using only
// its public surface: what a component says to whoever displays it (display.js), what its whole
// content is as JSON (data.js), and what it says to an LLM agent that drives it (agent.js). Both
// tell a model what a component takes as JSON Schema (json-schema.js) and why a call failed
// (errors.js).
export {
	AGENT_META,
	agentMetaSchemas,
	agentOf,
	agentProblems,
	agentTool,
	callArgs,
	hasAgentMeta,
	MAX_STEPS,
	maxStepsOf,
	nextAction,
	pendingResults,
	planToolCall,
	reportType,
	resultText,
	settledText,
	summaryOf,
	systemPrompt,
	toolCallsOf,
	toolResultMessage,
	toolsFor,
} from "./agent.js";
export {
	DATA_META,
	dataMetaSchemas,
	dataOf,
	dataProblems,
	dataSchema,
	fileFormatOf,
	hasDataMeta,
	JSON_FILE,
	loadData,
	sampleChoices,
	withSample,
} from "./data.js";
export { DISPLAY_META, displayLabel, displayMetaSchemas, displayOf } from "./display.js";
export { contractErrorText } from "./errors.js";
export { typeSchema } from "./json-schema.js";
