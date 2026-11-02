// The model behind the chat: { models() → Promise<[{ provider, id, name }]>, complete(request,
// signal) → Promise<AssistantMessage> }, pi-ai's shapes. A request is one inference step with
// everything it needs: { model: "provider/id", systemPrompt, tools, transcript }, the transcript
// being the whole session; the answer is the message to append to it. One client talks to the
// micro-agents server (apps/microagents/server.js), which keeps no state; one replays a script.

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

// The server at api (a URL ending in /api/); no models when there's none, as on a static host.
export const httpClient = (api) => ({
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

// An assistant message as pi-ai writes them: content blocks are strings (text) or
// { type: "toolCall", id?, name, arguments }.
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
		api: "scripted",
		provider,
		model: id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: content.some((b) => b.type === "toolCall") ? "toolUse" : "stop",
		timestamp: Date.now(),
	};
};

// Replays turns, each an assistant message, its blocks, or a function of the request giving
// either; then says the script is over.
export const scriptedClient = (turns) => {
	let i = 0;
	return {
		requests: [],
		models() {
			return Promise.resolve([{ provider: "scripted", id: "script", name: "Scripted" }]);
		},
		complete(request) {
			this.requests.push(request);
			let turn = turns[i++] ?? ["(the script is over)"];
			if (typeof turn === "function") turn = turn(request);
			return Promise.resolve(Array.isArray(turn) ? assistantMessage(turn) : turn);
		},
	};
};
