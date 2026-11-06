// The inference API any page can ask models through, keeping no state between requests:
//
//   GET  /api/check   { server: true, assistant, models: [{ provider, id, name }] }:
//                     the models of the providers with credentials
//   POST /api/infer   { model: { provider, id }, systemPrompt, tools, transcript }
//                     -> { message }: one step of a model with the tools the page gives
//
// The transcript is pi's (@earendil-works/pi-ai), which lowers it to each provider's format.
// The studio's server (studio-server.mjs) adds its own routes to these; tutuca's app server
// (../../scripts/app.js) serves them beside a demo. Pages served from another local port
// may call them (CORS), only local ones, since the server holds the API keys.
import { existsSync } from "node:fs";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { modelRule } from "./studio-models.mjs";

// pi's models, for a server outside this package, which can't resolve pi itself.
export { builtinModels };

// The chat models of the providers that have credentials, those offer picks (by default, the
// ones studio-models.mjs's rules match).
export async function availableModels(models, offer = (m) => modelRule(m.id) !== null) {
	const out = [];
	for (const provider of models.getProviders()) {
		let auth;
		try {
			auth = await models.getAuth(provider.id);
		} catch {
			continue; // broken credentials: as if it had none
		}
		if (!auth) continue;
		for (const m of models.getModels(provider.id)) if (offer(m)) out.push({ provider: provider.id, id: m.id, name: m.name ?? m.id });
	}
	return out;
}

export const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
export const readJson = async (req, limit = 4 * 1024 * 1024) => {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("the request is too large");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

// The model wanted ({ provider, id }) out of models, if offer offers it and it has credentials.
export async function offeredModel(models, offer, wanted) {
	const model = wanted && models.getModel(wanted.provider, wanted.id);
	if (!model) return null;
	const available = await availableModels(models, offer);
	return available.some((m) => m.provider === wanted.provider && m.id === wanted.id) ? model : null;
}

// GET /api/check and POST /api/infer, asking models (a pi Models collection) and offering the
// ones offer picks, as routes ("METHOD /path" -> handler(req, res)).
export function inferenceRoutes({ models = builtinModels(), offer } = {}) {
	return {
		"GET /api/check": async (_req, res) => {
			const available = await availableModels(models, offer);
			json(res, 200, { server: true, assistant: available.length > 0, models: available });
		},
		"POST /api/infer": async (req, res) => {
			const { model: wanted, systemPrompt: system, tools, transcript } = await readJson(req);
			if (typeof system !== "string") return json(res, 400, { error: "no systemPrompt" });
			if (!Array.isArray(tools)) return json(res, 400, { error: "no tools" });
			if (!Array.isArray(transcript) || transcript.length === 0) return json(res, 400, { error: "no transcript" });
			const model = await offeredModel(models, offer, wanted);
			if (!model) return json(res, 400, { error: `no model ${wanted?.provider}/${wanted?.id} with credentials here` });
			// The request ends when the page stops waiting for it.
			const controller = new AbortController();
			res.on("close", () => controller.abort());
			const message = await models.complete(model, { systemPrompt: system, messages: transcript, tools }, { signal: controller.signal });
			if (!res.writableEnded) json(res, 200, { message });
		},
	};
}

const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
// A handler(req, res) for a static server (serve.mjs's createStaticServer) that answers routes
// under /api/, resolving true when it did: a local page on another port may call them.
export function apiHandler(routes) {
	return async (req, res) => {
		const path = new URL(req.url, "http://x").pathname;
		const origin = req.headers.origin;
		if (path.startsWith("/api/") && typeof origin === "string" && LOCAL_ORIGIN.test(origin)) {
			res.setHeader("access-control-allow-origin", origin);
			res.setHeader("vary", "origin");
			if (req.method === "OPTIONS") {
				res.writeHead(204, { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" }).end();
				return true;
			}
		}
		const handler = routes[`${req.method} ${path}`];
		if (!handler) return false;
		try {
			await handler(req, res);
		} catch (error) {
			if (!res.headersSent) json(res, 500, { error: error.message });
		}
		return true;
	};
}

// Loads the API keys from envFile, if there is one, into process.env.
export const loadEnv = (envFile) => {
	if (existsSync(envFile)) process.loadEnvFile(envFile);
};
// What the server says on start about the models it found.
export const modelsReport = (available, envFile) => {
	const providers = [...new Set(available.map((m) => m.provider))];
	return providers.length > 0 ? `models from ${providers.join(", ")} (${available.length})` : `no API keys found (${envFile} or the environment): no models to ask`;
};
