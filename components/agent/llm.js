// The models an agent asks: a client is { complete(request, signal) → Promise<AssistantMessage> }
// in pi-ai's shapes, a request one inference step with everything it needs: { model:
// "provider/id", systemPrompt, tools, transcript }; the answer is the message to append.
// httpClient asks the studio server's stateless POST /api/infer (tutuca-wax/scripts/
// studio-server.mjs); scriptedClient replays turns, for tests; echoStep is a model without a
// model, for a demo without keys: it runs the tool the user names, synchronously.

const post = async (url, body, signal) => {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	const out = await res.json().catch(() => ({ error: `the server answered ${res.status}` }));
	if (!res.ok || out.error) throw new Error(out.error ?? `the server answered ${res.status}`);
	return out;
};

// The server at api, a URL ending in /api/.
export const httpClient = (api) => ({
	// [{ provider, id, name }]: the models it has keys for; none without a server.
	async models() {
		try {
			const res = await fetch(new URL("check", api), { cache: "no-store" });
			const body = res.ok ? await res.json() : null;
			return body?.server ? body.models : [];
		} catch {
			return [];
		}
	},
	async complete({ model, systemPrompt, tools, transcript }, signal) {
		const [provider, ...rest] = model.split("/");
		const body = { model: { provider, id: rest.join("/") }, systemPrompt, tools, transcript };
		return (await post(new URL("infer", api), body, signal)).message;
	},
});

// An assistant message as pi-ai writes them: blocks are strings (text) or { name, arguments,
// id? } (tool calls).
export const assistantMessage = (blocks, model = "scripted/script") => {
	const content = blocks.map((b, i) =>
		typeof b === "string"
			? { type: "text", text: b }
			: { type: "toolCall", id: b.id ?? `call-${i}-${b.name}`, ...b },
	);
	const [provider, id] = model.split("/");
	return {
		role: "assistant",
		content,
		provider,
		model: id,
		stopReason: content.some((b) => b.type === "toolCall") ? "toolUse" : "stop",
	};
};

// Replays turns, each an assistant message, its blocks, or a function of the request giving
// either; then says the script is over.
export const scriptedClient = (turns) => {
	let i = 0;
	return {
		requests: [],
		complete(request) {
			this.requests.push(request);
			let turn = turns[i++] ?? ["(the script is over)"];
			if (typeof turn === "function") turn = turn(request);
			return Promise.resolve(Array.isArray(turn) ? assistantMessage(turn) : turn);
		},
	};
};

// The next step of a model that only follows orders: to `/tool_name {"arg": ...}` it calls the
// tool with those arguments; after tool results it repeats the last one; to anything else it
// lists its tools.
export const echoStep = ({ tools, transcript }) => {
	const last = transcript.at(-1);
	const say = (text) => assistantMessage([text], "echo/echo");
	if (last?.role === "toolResult") {
		const text = last.content.map((b) => b.text).join("\n");
		return say(last.isError ? `That failed: ${text}` : `Done. Now:\n${text}`);
	}
	const text = typeof last?.content === "string" ? last.content.trim() : "";
	const match = /^\/(\w+)\s*(.*)$/s.exec(text);
	const names = tools.map((tl) => tl.name);
	if (match === null || !names.includes(match[1])) {
		const list = tools
			.map(
				(tl) =>
					`/${tl.name} ${JSON.stringify(Object.fromEntries(Object.keys(tl.parameters.properties).map((k) => [k, "…"])))}`,
			)
			.join("\n");
		return say(`I'm the echo model: I run the tool you name, like\n${list}`);
	}
	let args;
	try {
		args = match[2].trim() === "" ? {} : JSON.parse(match[2]);
	} catch {
		return say(`Its arguments aren't JSON: ${match[2]}`);
	}
	return assistantMessage(
		[{ id: `echo-${transcript.length}`, name: match[1], arguments: args }],
		"echo/echo",
	);
};

// The ask handlers an agent needs: models, those the studio server at api offers (none
// without it); infer, the echo model for echo/..., synchronously (so stories and tests run
// whole loops), else the studio server.
export const agentAskHandlers = ({ api = "http://127.0.0.1:8003/api/" } = {}) => {
	const http = httpClient(api);
	return {
		models: () => http.models(),
		// Whether there's a model to ask: a canvas offers agents only then.
		inferenceAvailable: async () => (await http.models()).length > 0,
		// In a settle scope (an agent another one prompted), its signal aborts it when stopped.
		infer: ([request], read) =>
			request.model.startsWith("echo/") ? echoStep(request) : http.complete(request, read?.signal),
	};
};
