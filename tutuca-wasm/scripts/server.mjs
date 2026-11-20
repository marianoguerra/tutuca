// The site served with models behind it: _site/'s files, as serve.mjs serves them, and an API
// the pages find at /api/ (on a static host there's none: the micro-agents' chat can't run, and
// the studio shows no assistant).
//
//   GET  /api/check   { server: true, assistant, models: [{ provider, id, name }] }: the models
//                     of the providers with credentials
//   POST /api/infer   { model: { provider, id }, systemPrompt, tools, transcript } -> { message }:
//                     one step of a model with the tools the page gives (the micro-agents'),
//                     keeping nothing between requests
//   POST /api/chat    { model: { provider, id }, messages, component: { name, source } }
//                     -> { message }: the studio assistant's next message
//   POST /api/prompt  { component } -> { prompt }: the system prompt it would get
//
// The transcripts are pi's (@earendil-works/pi-ai), which lowers them to each provider's
// format. The studio's model edits the component through one tool, write_component, writing the
// whole module; the studio checks and compiles it and answers with the diagnostics. Its system
// prompt is read on every request from studio/assistant/: its *.md files in order and the
// examples, so editing them needs no restart.
//
// API keys come from the environment, and from .env in this directory's parent (or the file
// --env names) when there is one: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY,
// OPENROUTER_API_KEY, ... (pi-ai's README lists them all). The file is read, never served.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	apiHandler,
	availableModels,
	builtinModels,
	inferenceRoutes,
	json,
	loadEnv,
	modelsReport,
	offeredModel,
	readJson,
} from "./inference-api.mjs";
import { createStaticServer } from "./serve.mjs";

const ASSISTANT = new URL("../studio/assistant/", import.meta.url);

// The one tool: the whole new text of the module.
export const TOOLS = [
	{
		name: "write_component",
		description:
			"Replace the component module with a new version: its whole text, never a diff or a fragment. The studio checks and compiles the module and answers with pure-tutuca's diagnostics, or with the types it registers when it built.",
		parameters: {
			type: "object",
			properties: {
				source: { type: "string", description: "The whole new module, name.tutuca.ts." },
			},
			required: ["source"],
		},
	},
];

// ---- The system prompt ------------------------------------------------------------------

const fence = (lang, text) => `\`\`\`${lang}\n${text.replace(/\n*$/, "\n")}\`\`\``;

// The reference (studio/assistant/*.md, in order), the examples, and the component as it is
// now.
export async function systemPrompt(component) {
	const names = (await readdir(ASSISTANT)).filter((f) => f.endsWith(".md")).sort();
	const parts = await Promise.all(names.map((f) => readFile(new URL(f, ASSISTANT), "utf8")));
	const examples = new URL("examples/", ASSISTANT);
	const files = (await readdir(examples)).filter((f) => f.endsWith(".tutuca.ts")).sort();
	for (const file of files) {
		const name = file.replace(/\.tutuca\.ts$/, "");
		parts.push(
			`## Example: ${name}\n\n${file}:\n\n${fence("ts", await readFile(new URL(file, examples), "utf8"))}`,
		);
	}
	if (component) {
		parts.push(
			`# The module you're editing: ${component.name}\n\nIt's ${component.name}.tutuca.ts, as it is now (the user may have edited it since your last change):\n\n${fence("ts", component.source ?? "")}`,
		);
	}
	return parts.map((p) => p.trim()).join("\n\n");
}

// ---- The server -----------------------------------------------------------------------------

/** The server, asking models (a pi Models collection), offering the ones offer picks. */
export function createServer({ models = builtinModels(), offer } = {}) {
	const api = {
		...inferenceRoutes({ models, offer }),
		"POST /api/prompt": async (req, res) => {
			const { component } = await readJson(req);
			json(res, 200, { prompt: await systemPrompt(component) });
		},
		"POST /api/chat": async (req, res) => {
			const { model: wanted, messages, component } = await readJson(req);
			const model = await offeredModel(models, offer, wanted);
			if (!model) {
				const name = `${wanted?.provider}/${wanted?.id}`;
				json(res, 400, { error: `no model ${name} with credentials here` });
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
	return createStaticServer(apiHandler(api));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const envAt = args.indexOf("--env");
	const envFile =
		envAt >= 0 ? args.splice(envAt, 2)[1] : fileURLToPath(new URL("../.env", import.meta.url));
	loadEnv(envFile);
	const port = Number(args[0] ?? 8003);
	const models = builtinModels();
	const available = await availableModels(models);
	createServer({ models }).listen(port, "127.0.0.1", () => {
		console.log(`the studio at http://127.0.0.1:${port}/studio/`);
		console.log(`the micro-agents at http://127.0.0.1:${port}/microagents/?loadAgents=all`);
		console.log(modelsReport(available, envFile));
	});
}
