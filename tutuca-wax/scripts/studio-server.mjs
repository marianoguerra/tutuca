// The studio served with an LLM assistant: this directory's files, as
// scripts/serve.mjs serves them, and an API the studio finds at ../api/ (on a
// static host, like GitHub Pages, there's none, and it shows no assistant).
//
//   GET  /api/check   { server: true, assistant, models: [{ provider, id, name }] }:
//                     the models of the providers with credentials
//   POST /api/chat    { model: { provider, id }, messages, component: { name, tcd, wax } }
//                     -> { message }: the model's next message
//   POST /api/prompt  { component } -> { prompt }: the system prompt it would get
//
// The transcript is pi's (@earendil-works/pi-ai): user messages, the model's
// assistant messages as it returned them, and the studio's tool results; pi
// lowers it to each provider's format, so a conversation can change models.
// The model edits the component through one tool, write_component; the studio
// builds what it wrote with tcd and answers with the diagnostics.
//
// The models offered are the ones scripts/studio-models.mjs's rules pick.
// API keys come from the environment, and from .env next to this directory's
// package.json (or the file --env names) when there is one: OPENAI_API_KEY,
// ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, ... (pi-ai's README
// lists them all). The system prompt is read on every request from
// studio/assistant/: its *.md files in order, the examples, and the runtime's
// functions from src/abi.wax, so editing them needs no restart.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createStaticServer } from "./serve.mjs";
import { modelRule } from "./studio-models.mjs";

const root = new URL("../", import.meta.url);
const ASSISTANT = new URL("studio/assistant/", root);

// The one tool: the whole new text of the files it changes.
export const TOOLS = [
	{
		name: "write_component",
		description:
			"Replace the component module's files with new versions. Give the whole text of each file you change; leave out a file you don't change. The studio builds the module and answers with tcd's diagnostics, or with the types it registers when it built.",
		parameters: Type.Object({
			tcd: Type.Optional(Type.String({ description: "The whole new .tcd file: the component definition." })),
			wax: Type.Optional(Type.String({ description: "The whole new .wax file: the functions the .tcd needs." })),
		}),
	},
];

// ---- The system prompt ------------------------------------------------------------------

// The runtime functions a component module can call, from src/abi.wax: the
// sections a component's own code uses, and the few functions of other
// sections it uses too (listed after them), as `fn name(params) -> result`.
const ABI_SECTIONS = ["Values", "List and Map", "Path keys", "What a handler does", "Helpers for writing component types"];
const ABI_ALSO = ["value_to_f64", "value_member"];
export function runtimeFunctions(abi) {
	const out = [];
	const also = [];
	let section = null;
	let keep = false;
	const lines = abi.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("// ") && lines[i - 1] === "") {
			section = line.slice(3);
			keep = ABI_SECTIONS.some((s) => section.startsWith(s));
			if (keep) out.push("", `// ${section.replace(/\s*\(.*$/, "")}`);
			continue;
		}
		if (!line.startsWith("fn abi_")) continue;
		const extra = ABI_ALSO.includes(line.match(/^fn abi_(\w+)/)[1]);
		if (!keep && !extra) continue;
		let signature = line;
		while (!signature.trimEnd().endsWith("{") && i + 1 < lines.length) signature += ` ${lines[++i].trim()}`;
		(keep ? out : also).push(`${signature.replace(/^fn abi_/, "fn ").replace(/\s*\{\s*$/, "").replace(/\(\s+/, "(").replace(/,\s*\)/, ")")};`);
	}
	if (also.length) out.push("", "// Reading values", ...also);
	return out.join("\n").trim();
}

const fence = (lang, text) => `\`\`\`${lang}\n${text.replace(/\n*$/, "\n")}\`\`\``;

// The reference (studio/assistant/*.md, in order), the examples, the runtime's
// functions, and the component as it is now.
export async function systemPrompt(component) {
	const names = (await readdir(ASSISTANT)).filter((f) => f.endsWith(".md")).sort();
	const parts = await Promise.all(names.map((f) => readFile(new URL(f, ASSISTANT), "utf8")));
	const examples = new URL("examples/", ASSISTANT);
	const files = (await readdir(examples)).filter((f) => f.endsWith(".tcd")).sort();
	for (const file of files) {
		const name = file.replace(/\.tcd$/, "");
		const tcd = await readFile(new URL(file, examples), "utf8");
		const wax = await readFile(new URL(`${name}.wax`, examples), "utf8");
		parts.push(`## Example: ${name}\n\n${name}.tcd:\n\n${fence("wit", tcd)}\n\n${name}.wax:\n\n${fence("wax", wax)}`);
	}
	const abi = await readFile(new URL("src/abi.wax", root), "utf8");
	parts.push(`# The runtime functions a .wax can call\n\n${fence("wax", runtimeFunctions(abi))}`);
	if (component) {
		parts.push(
			`# The module you're editing: ${component.name}\n\nIts files are ${component.name}.tcd and ${component.name}.wax, as they are now (the user may have edited them since your last change).\n\n${component.name}.tcd:\n\n${fence("wit", component.tcd ?? "")}\n\n${component.name}.wax:\n\n${fence("wax", component.wax ?? "")}`,
		);
	}
	return parts.map((p) => p.trim()).join("\n\n");
}

// ---- Models -----------------------------------------------------------------------------

// The chat models of the providers that have credentials, those offer picks
// (by default, the ones studio-models.mjs's rules match).
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

// ---- The server -------------------------------------------------------------------------

const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
const readJson = async (req, limit = 4 * 1024 * 1024) => {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("the request is too large");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

// The studio's server, asking models (a pi Models collection) for the chat,
// offering the ones offer picks (availableModels).
export function createStudioServer({ models = builtinModels(), offer } = {}) {
	const api = {
		"GET /api/check": async (req, res) => {
			const available = await availableModels(models, offer);
			json(res, 200, { server: true, assistant: available.length > 0, models: available });
		},
		"POST /api/prompt": async (req, res) => {
			const { component } = await readJson(req);
			json(res, 200, { prompt: await systemPrompt(component) });
		},
		"POST /api/chat": async (req, res) => {
			const { model: wanted, messages, component } = await readJson(req);
			const model = wanted && models.getModel(wanted.provider, wanted.id);
			if (!model || !(await availableModels(models, offer)).some((m) => m.provider === wanted.provider && m.id === wanted.id)) {
				json(res, 400, { error: `no model ${wanted?.provider}/${wanted?.id} with credentials here` });
				return;
			}
			if (!Array.isArray(messages) || messages.length === 0) {
				json(res, 400, { error: "no messages" });
				return;
			}
			// The request ends when the studio stops waiting for it.
			const controller = new AbortController();
			res.on("close", () => controller.abort());
			const context = { systemPrompt: await systemPrompt(component), messages, tools: TOOLS };
			const message = await models.complete(model, context, { signal: controller.signal });
			if (!res.writableEnded) json(res, 200, { message });
		},
	};
	return createStaticServer({}, async (req, res) => {
		const handler = api[`${req.method} ${new URL(req.url, "http://x").pathname}`];
		if (!handler) return false;
		try {
			await handler(req, res);
		} catch (error) {
			if (!res.headersSent) json(res, 500, { error: error.message });
		}
		return true;
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const envAt = args.indexOf("--env");
	const envFile = envAt >= 0 ? args.splice(envAt, 2)[1] : fileURLToPath(new URL(".env", root));
	if (existsSync(envFile)) process.loadEnvFile(envFile);
	const port = Number(args[0] ?? 8003);
	const models = builtinModels();
	const available = await availableModels(models);
	createStudioServer({ models }).listen(port, "127.0.0.1", () => {
		console.log(`the studio at http://127.0.0.1:${port}/studio/`);
		const providers = [...new Set(available.map((m) => m.provider))];
		console.log(providers.length > 0 ? `assistant models from ${providers.join(", ")} (${available.length})` : `no API keys found (${envFile} or the environment): the studio runs without its assistant`);
	});
}
