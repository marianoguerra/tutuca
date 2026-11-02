// The micro-agents app's server: the app at /, its storybook at /storybook.html, the repo's
// files they load by path, and an API the page finds at /api/. It's a thin pi-ai proxy that
// keeps no state: each micro-agent holds its own session and sends all of it on every step,
// so any number of them can run against one server:
//
//   GET  /api/check   { server: true, models: [{ provider, id, name }] }: the models of the
//                     providers with credentials that tutuca-wax/scripts/studio-models.mjs offers
//   POST /api/infer   { model: { provider, id }, systemPrompt, tools, transcript } -> { message }:
//                     one inference step; transcript is the whole session (pi's messages) and
//                     message is the one assistant message to append to it
//
// API keys come from the environment and from .env at the repo's root (or the file --env names):
// ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, … (pi-ai's README).
//
//   node apps/microagents/server.js [port] [--env file]
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { modelRule } from "../../tutuca-wax/scripts/studio-models.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
// The app's own pages, served at the root.
const PAGES = {
	"/": "apps/microagents/index.html",
	"/storybook.html": "apps/microagents/storybook.html",
};
const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".md": "text/markdown; charset=utf-8",
	".wasm": "application/wasm",
	".svg": "image/svg+xml",
};

const json = (res, status, body) =>
	res
		.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
		.end(JSON.stringify(body));
const readJson = async (req, limit = 8 * 1024 * 1024) => {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("the request is too large");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

// The chat models of the providers with credentials that offer picks.
export async function availableModels(models, offer = (m) => modelRule(m.id) !== null) {
	const out = [];
	for (const provider of models.getProviders()) {
		let auth;
		try {
			auth = await models.getAuth(provider.id);
		} catch {
			continue;
		}
		if (!auth) continue;
		for (const m of models.getModels(provider.id))
			if (offer(m)) out.push({ provider: provider.id, id: m.id, name: m.name ?? m.id });
	}
	return out;
}

export function createMicroagentsServer({ models = builtinModels(), offer } = {}) {
	const api = {
		"GET /api/check": async (_req, res) =>
			json(res, 200, { server: true, models: await availableModels(models, offer) }),
		"POST /api/infer": async (req, res) => {
			const { model: wanted, systemPrompt, tools, transcript } = await readJson(req);
			if (typeof systemPrompt !== "string") return json(res, 400, { error: "no systemPrompt" });
			if (!Array.isArray(tools)) return json(res, 400, { error: "no tools" });
			if (!Array.isArray(transcript) || transcript.length === 0)
				return json(res, 400, { error: "no transcript" });
			const offered = await availableModels(models, offer);
			const model = wanted && models.getModel(wanted.provider, wanted.id);
			if (!model || !offered.some((m) => m.provider === wanted.provider && m.id === wanted.id)) {
				return json(res, 400, {
					error: `no model ${wanted?.provider}/${wanted?.id} with credentials here`,
				});
			}
			const controller = new AbortController();
			res.on("close", () => controller.abort());
			const message = await models.complete(
				model,
				{ systemPrompt, messages: transcript, tools },
				{ signal: controller.signal },
			);
			if (!res.writableEnded) json(res, 200, { message });
		},
	};
	return createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		const handler = api[`${req.method} ${url.pathname}`];
		if (handler) {
			try {
				await handler(req, res);
			} catch (error) {
				if (!res.headersSent) json(res, 500, { error: error.message });
			}
			return;
		}
		const path = PAGES[url.pathname] ?? decodeURIComponent(url.pathname);
		if (path.endsWith("/"))
			return res.writeHead(302, { location: `${path}index.html${url.search}` }).end();
		const file = normalize(join(root, path));
		if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return res.writeHead(403).end();
		try {
			const body = await readFile(file);
			res
				.writeHead(200, {
					"content-type": TYPES[extname(file)] ?? "application/octet-stream",
					"cache-control": "no-store",
				})
				.end(body);
		} catch {
			res.writeHead(404).end();
		}
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const envAt = args.indexOf("--env");
	const envFile = envAt >= 0 ? args.splice(envAt, 2)[1] : join(root, ".env");
	if (existsSync(envFile)) process.loadEnvFile(envFile);
	const port = Number(args[0] ?? 8004);
	const models = builtinModels();
	const available = await availableModels(models);
	createMicroagentsServer({ models }).listen(port, "127.0.0.1", () => {
		console.log(`micro-agents at http://127.0.0.1:${port}/ (storybook: /storybook.html)`);
		const providers = [...new Set(available.map((m) => m.provider))];
		console.log(
			providers.length > 0
				? `models from ${providers.join(", ")} (${available.length})`
				: `no API keys found (${envFile} or the environment): the chat is off, the tools work`,
		);
	});
}
