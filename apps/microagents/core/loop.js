// The agent loop's steps, on a pi-ai transcript: the user's messages, the model's assistant
// messages and the results of the tools it called. nextAction says what comes next.
export const MAX_STEPS = 12;

export const userMessage = (text, timestamp = Date.now()) => ({
	role: "user",
	content: text,
	timestamp,
});

export const toolCallsOf = (msg) =>
	msg?.role === "assistant" ? msg.content.filter((block) => block.type === "toolCall") : [];

// The model's turns since the user last spoke.
const stepsSinceUser = (transcript) => {
	let n = 0;
	for (let i = transcript.length - 1; i >= 0 && transcript[i].role !== "user"; i--) {
		if (transcript[i].role === "assistant") n++;
	}
	return n;
};

// What the loop does next:
//   { kind: "complete" }                 ask the model for its next message
//   { kind: "tools", calls }             run the tool calls not answered yet, in order
//   { kind: "idle", reason }             wait for the user
export const nextAction = (transcript, { maxSteps = MAX_STEPS } = {}) => {
	const last = transcript.at(-1);
	if (last === undefined) return { kind: "idle", reason: "" };
	let i = transcript.length - 1;
	while (i >= 0 && transcript[i].role === "toolResult") i--;
	const asked = transcript[i];
	if (asked?.role === "assistant") {
		if (asked.stopReason === "error" || asked.stopReason === "aborted") {
			return { kind: "idle", reason: asked.errorMessage ?? asked.stopReason };
		}
		const answered = new Set(transcript.slice(i + 1).map((m) => m.toolCallId));
		const calls = toolCallsOf(asked).filter((c) => !answered.has(c.id));
		if (calls.length > 0) return { kind: "tools", calls };
		if (last.role === "assistant") return { kind: "idle", reason: "" };
	}
	if (stepsSinceUser(transcript) >= maxSteps) {
		return { kind: "idle", reason: `stopped after ${maxSteps} steps; say "go on" to continue` };
	}
	return { kind: "complete" };
};

// The text of a message's content, for display.
export const textOf = (msg) =>
	typeof msg.content === "string"
		? msg.content
		: msg.content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");

// The standing part of an agent's system prompt: its prompt, its skills index and how its tools
// work. A session keeps it from the start; each step adds the data as it is then.
export const agentPrompt = (prompt, skillsIndexText) =>
	[
		prompt.trim(),
		skillsIndexText,
		"Your tools change the data by sending messages to the workspace, as its buttons do; the user may also have edited it since your last turn.",
		"Tool arguments are JSON values: send objects and arrays as themselves, never as JSON text in a string. A tool call that fails changes nothing and says why: act on the reason rather than sending the same call again.",
	]
		.filter((s) => s !== "")
		.join("\n\n");

// The system prompt for a step: the standing prompt and root's summary now.
export const systemPrompt = (prompt, root) =>
	`${prompt}\n\nThe data now:\n${typeof root.summary === "string" ? root.summary : "(the agent gives no summary; call get_state)"}`;

// One inference step, with everything the server needs and nothing it has to remember: the
// model ("provider/id"), the system prompt, the tools and the whole transcript.
export const stepRequest = ({ model, prompt, root, tools, transcript }) => ({
	model,
	systemPrompt: systemPrompt(prompt, root),
	tools,
	transcript,
});
