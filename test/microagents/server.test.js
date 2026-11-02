// The micro-agents server keeps no state: every /api/infer request brings the whole session
// (system prompt, tools, transcript) and gets back the one message to append.
import assert from "node:assert/strict";
import test from "node:test";
import { createMicroagentsServer } from "../../apps/microagents/server.js";

// pi-ai's models API, as much as the server uses, answering "seen N messages".
const fakeModels = () => {
	const calls = [];
	const model = { id: "m", name: "M" };
	return {
		calls,
		getProviders: () => [{ id: "p" }],
		getAuth: async () => ({ key: "k" }),
		getModels: () => [model],
		getModel: (provider, id) => (provider === "p" && id === "m" ? model : undefined),
		complete: (m, context) => {
			calls.push({ model: m, context });
			return Promise.resolve({
				role: "assistant",
				content: [{ type: "text", text: `seen ${context.messages.length}` }],
			});
		},
	};
};

const serve = async () => {
	const models = fakeModels();
	const server = createMicroagentsServer({ models, offer: () => true });
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${server.address().port}/api/`;
	const post = async (body) => {
		const res = await fetch(`${base}infer`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		return { status: res.status, body: await res.json() };
	};
	return { models, post, base, close: () => new Promise((resolve) => server.close(resolve)) };
};

const user = (text) => ({ role: "user", content: text, timestamp: 0 });
const tool = { name: "t", description: "a tool", parameters: { type: "object", properties: {} } };

test("each infer request is answered from what it brings, nothing kept between them", async () => {
	const { models, post, base, close } = await serve();
	try {
		const check = await (await fetch(`${base}check`)).json();
		assert.deepEqual(check, { server: true, models: [{ provider: "p", id: "m", name: "M" }] });
		const one = await post({
			model: { provider: "p", id: "m" },
			systemPrompt: "you are A",
			tools: [tool],
			transcript: [user("hi")],
		});
		const two = await post({
			model: { provider: "p", id: "m" },
			systemPrompt: "you are B",
			tools: [],
			transcript: [user("a"), { role: "assistant", content: [] }, user("b")],
		});
		assert.equal(one.status, 200);
		assert.equal(one.body.message.content[0].text, "seen 1");
		assert.equal(two.body.message.content[0].text, "seen 3");
		assert.deepEqual(models.calls[0].context, {
			systemPrompt: "you are A",
			messages: [user("hi")],
			tools: [tool],
		});
		assert.equal(models.calls[1].context.systemPrompt, "you are B");
		assert.deepEqual(models.calls[1].context.tools, []);
	} finally {
		await close();
	}
});

test("infer rejects a request that doesn't bring everything", async () => {
	const { models, post, close } = await serve();
	try {
		const model = { provider: "p", id: "m" };
		const full = { model, systemPrompt: "s", tools: [], transcript: [user("hi")] };
		assert.match((await post({ ...full, transcript: [] })).body.error, /no transcript/);
		assert.match((await post({ ...full, systemPrompt: undefined })).body.error, /no systemPrompt/);
		assert.match((await post({ ...full, tools: undefined })).body.error, /no tools/);
		const unknown = await post({ ...full, model: { provider: "p", id: "x" } });
		assert.equal(unknown.status, 400);
		assert.match(unknown.body.error, /no model p\/x/);
		assert.equal(models.calls.length, 0);
	} finally {
		await close();
	}
});

test("the app is at / and its storybook at /storybook.html", async () => {
	const { base, close } = await serve();
	try {
		for (const [path, title] of [
			["/", "<title>Micro-agents</title>"],
			["/storybook.html", "<title>Micro-agents Storybook</title>"],
		]) {
			const res = await fetch(new URL(path, base));
			assert.equal(res.status, 200);
			assert.match(res.headers.get("content-type"), /text\/html/);
			assert.ok((await res.text()).includes(title));
		}
	} finally {
		await close();
	}
});
