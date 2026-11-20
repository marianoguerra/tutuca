// The agent loop over a transcript of pi-ai messages, for any host: what to do next (ask the
// model, run tool calls, or stop), the messages that answer tool calls, and what a message
// tool's watch says once it settled. The tools and running one are agent.js.
import { t, WATCH_OUTCOMES } from "../tutuca.js";
import { agentOf, resultText } from "./agent.js";

// The most steps (model turns) an agent takes for one prompt, unless its target's meta says.
const MAX_STEPS = 12;
export const maxStepsOf = (c) => agentOf(c).maxSteps ?? MAX_STEPS;
// The tool calls of a pi-ai assistant message.
const toolCallsOf = (message) =>
	message?.role === "assistant" && Array.isArray(message.content)
		? message.content.filter((b) => b?.type === "toolCall")
		: [];
// What an agent does next with transcript (pi-ai messages): infer (ask the model), tools (run
// calls, the last assistant message's calls without a result yet), or complete (the model
// answered without calling a tool, or nothing was asked).
export const nextAction = (transcript) => {
	let i = transcript.length - 1;
	const answered = new Set();
	while (i >= 0 && transcript[i].role === "toolResult") answered.add(transcript[i--].toolCallId);
	const last = transcript[i];
	if (last === undefined) return { action: "complete", calls: [] };
	if (last.role === "user") return { action: "infer", calls: [] };
	const calls = toolCallsOf(last);
	if (calls.length === 0) return { action: "complete", calls: [] };
	const pending = calls.filter((call) => !answered.has(call.id));
	return pending.length > 0 ? { action: "tools", calls: pending } : { action: "infer", calls: [] };
};
// A pi-ai tool result message.
export const toolResultMessage = (call, text, isError = false) => ({
	role: "toolResult",
	toolCallId: call.id,
	toolName: call.name,
	content: [{ type: "text", text }],
	isError,
});
// What a watch (src/tree/watch.js) tells its watcher: a tool's message and everything it
// caused ran (ok), some of it threw (failed), or it was stopped (cancelled, timeout).
export const reportType = t.record({
	id: t.number(),
	outcome: t.enum(WATCH_OUTCOMES),
	tasks: t.int({ min: 0 }),
	failed: t.int({ min: 0 }),
});
// What answers a message tool's call once its watch settled with report: what c looks
// like after (its result query) and, when it didn't go well, why; and whether it's an error.
export const settledText = (c, result, report) => {
	const now = resultText(c, result);
	if (report.outcome === "ok") return { text: now, isError: false };
	const why =
		report.outcome === "failed"
			? `It ran, but ${report.failed} of the ${report.tasks} steps it took failed.`
			: report.outcome === "timeout"
				? "It took too long and was stopped."
				: "It was stopped before it finished.";
	return { text: `${why} Now: ${now}`, isError: true };
};
// Results for the tool calls of transcript's last assistant message that have none, saying
// text: a transcript a stopped loop left is one a model can be asked about again.
export const pendingResults = (transcript, text) => {
	const { action, calls } = nextAction(transcript);
	return action === "tools" ? calls.map((call) => toolResultMessage(call, text, true)) : [];
};
