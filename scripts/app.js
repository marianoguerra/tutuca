// A demo as an app: served alone, without the demos' chrome (the demo bar, its sync and bundle
// switchers, the time travel bar and the sync log), with the inference API beside it so its
// agents can ask models. Any demo works, whether it asks models or not.
//
//   node scripts/app.js <demo> [port] [--env file] [--no-inference]
//   just app canvas            # http://127.0.0.1:8010/?bundle=agent
//
// / redirects to the demo's bare page, keeping the query (?sync=, ?doc=, ?history=, ?bundle=):
// /demos/<demo>/app.html, the demo's own index.html without its demo bar, its body marked
// data-chrome="none" (boot then adds no time travel bar or sync log), and a <meta
// name="tutuca-api"> saying where the API is, so agents ask this server. Every demo's bare
// page is there, and the rest of the repo is served as is.
//
// The API (GET /api/check, POST /api/infer) is tutuca-wax's (tutuca-wax/scripts/
// inference-api.mjs), with its dependencies (npm install in tutuca-wax). API keys come from the
// environment, and from tutuca-wax/.env (or the file --env names). With --no-inference, or
// without tutuca-wax's dependencies, the demo runs without models: agents aren't offered.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "../tutuca-wax/scripts/serve.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const demoIndex = (name) => new URL(`../demos/${name}/index.html`, import.meta.url);
const BARE = /^\/demos\/([\w-]+)\/app\.html$/;

// A demo's index.html without the demos' chrome: no demo bar, the body marked
// data-chrome="none", and, with api, where the inference API is.
export const bareShell = (html, { api = null } = {}) => {
	let out = html.replace(/\s*<header class="demo-bar">[\s\S]*?<\/header>/, "");
	out = out.replace(/<body(\s|>)/, '<body data-chrome="none"$1');
	if (api !== null) {
		out = out.replace("</head>", `  <meta name="tutuca-api" content="${api}" />\n  </head>`);
	}
	return out;
};

// The inference API's handler, or null (with why) when it can't be had.
const loadInference = async (envFile) => {
	try {
		const { apiHandler, availableModels, builtinModels, inferenceRoutes, loadEnv, modelsReport } =
			await import("../tutuca-wax/scripts/inference-api.mjs");
		loadEnv(envFile);
		const models = builtinModels();
		const available = await availableModels(models);
		return {
			handle: apiHandler(inferenceRoutes({ models })),
			report: modelsReport(available, envFile),
		};
	} catch (error) {
		return {
			handle: null,
			report: `no inference API: tutuca-wax's dependencies didn't load (npm install in tutuca-wax): ${error.message}`,
		};
	}
};

// The server for demo: / goes to its bare page, every demo's bare page is served, and the API
// when handle (the inference API's) is given.
export const createAppServer = ({ demo, handle = null }) =>
	createStaticServer(
		{},
		async (req, res) => {
			const url = new URL(req.url, "http://x");
			if (url.pathname === "/") {
				res.writeHead(302, { location: `/demos/${demo}/app.html${url.search}` }).end();
				return true;
			}
			const bare = BARE.exec(url.pathname);
			if (bare !== null && existsSync(demoIndex(bare[1]))) {
				const html = await readFile(demoIndex(bare[1]), "utf8");
				const page = bareShell(html, { api: handle === null ? null : "/api/" });
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
				});
				res.end(page);
				return true;
			}
			return handle === null ? false : handle(req, res);
		},
		root,
	);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const envAt = args.indexOf("--env");
	const envFile =
		envAt >= 0
			? args.splice(envAt, 2)[1]
			: fileURLToPath(new URL("../tutuca-wax/.env", import.meta.url));
	const noInference = args.includes("--no-inference");
	const [demo, port = "8010"] = args.filter((a) => !a.startsWith("--"));
	if (demo === undefined || !existsSync(demoIndex(demo))) {
		console.error(`usage: node scripts/app.js <demo> [port] [--env file] [--no-inference]`);
		console.error(
			demo === undefined ? "which demo?" : `there's no demo ${demo} (demos/${demo}/index.html)`,
		);
		process.exit(1);
	}
	const { handle, report } = noInference
		? { handle: null, report: "no inference API (--no-inference)" }
		: await loadInference(envFile);
	createAppServer({ demo, handle }).listen(Number(port), "127.0.0.1", () => {
		console.log(`${demo} at http://127.0.0.1:${port}/`);
		console.log(report);
	});
}
