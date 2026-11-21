// The micro-agents' page: the page of microagents.tutuca.ts's MicroAgents (app.js answers its
// asks), with the kit at the runtime's base, the shell in a scope below it and each agent in
// another, the built-in agents from dist/agents/, the installed ones from IndexedDB (store.js),
// files dropped on the page (a JSON document opens with an agent, an agent's package
// installs), and the models of the server (/api/; a static host has none, and the chat can't
// run).
import { createRuntime } from "../dist/tutuca-wasm.js";
import { download, dragsFiles, moduleSources, pageStyles, textOf } from "../js/page.js";
import { COMPILER, MARGAUI, RUNTIME } from "../js/paths.js";
import { parsePackage } from "./agent.js";
import { createApp, SHELL } from "./app.js";
import { defineChartElements } from "./elements.js";
import { httpClient } from "./llm.js";
import { openStore } from "./store.js";

const UI = {
	body: "bg-base-200 text-base-content",
	dropping: "outline-2 outline-dashed outline-primary -outline-offset-4",
};
const MODEL_KEY = "tutuca-wasm-microagents:model";
const THEME_KEY = "tutuca-wasm-microagents:theme";
const kept = (key) => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};
const keep = (key, value) => {
	try {
		localStorage.setItem(key, value);
	} catch {}
};

const styles = await pageStyles(MARGAUI, Object.values(UI));
// The theme picked with the shell's toggle, kept in this browser; the system's until one is
// picked (pageStyles follows it, and a picked one stays put when the system's changes).
const applyTheme = (theme) => {
	if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
};
applyTheme(kept(THEME_KEY));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
	applyTheme(kept(THEME_KEY)),
);
document.body.className = UI.body;
defineChartElements();

const root = document.querySelector("#app");
root.textContent = "";
styles.watch(root);
const asks = {};
const tutuca = await createRuntime({
	document,
	rootNode: root,
	asks,
	runtime: RUNTIME,
	compiler: COMPILER,
});
const here = moduleSources(new URL("./", import.meta.url));
const kit = await here.read("kit/kit.tutuca.ts");
const must = (loaded, name) => {
	if (!loaded.ok) throw new Error(`${name}: ${loaded.diagnostics[0]?.message ?? "didn't load"}`);
};
must(await here.load(tutuca, "kit/kit.tutuca.ts"), "the kit");
must(await here.load(tutuca, "microagents.tutuca.ts", { scope: SHELL }), "the shell");

// The agents loaded at the start, built in or installed: none by default (a demo starts empty,
// and agents come in as their packages are dropped), every one with ?loadAgents=all, or the
// ones a comma-separated list names (?loadAgents=regex-lab,jq-lab).
const wanted = new URLSearchParams(location.search).get("loadAgents") ?? "";
const named = new Set(
	wanted
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean),
);
const loads = wanted.trim() === "all" ? () => true : (id) => named.has(id);
const agentsDir = new URL("../dist/agents/", import.meta.url);
const ids = JSON.parse(await textOf(new URL("index.json", agentsDir))).filter(loads);
const builtins = await Promise.all(
	ids.map(async (id) => JSON.parse(await textOf(new URL(`${id}.json`, agentsDir)))),
);
const store = await openStore().catch(() => null);
const client = httpClient(new URL("../api/", import.meta.url));
const models = await client.models();
const values = models.map((m) => `${m.provider}/${m.id}`);
const model = values.includes(kept(MODEL_KEY)) ? kept(MODEL_KEY) : (values[0] ?? "");

const app = await createApp({
	tutuca,
	kit,
	client,
	store,
	builtins,
	loads,
	download,
	rememberModel: (m) => keep(MODEL_KEY, m),
});
app.setModel(model);
Object.assign(asks, app.asks, {
	setTheme: ([theme]) => {
		applyTheme(theme);
		keep(THEME_KEY, theme);
		return true;
	},
});
tutuca.start(
	"MicroAgents",
	{
		agents: app.agentRows(),
		sessions: [],
		models: models.map((m) => ({
			value: `${m.provider}/${m.id}`,
			name: `${m.provider} · ${m.name}`,
		})),
		model,
		theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
		status:
			models.length === 0
				? "No models: serve this page with the micro-agents' server (and API keys in .env) to chat with the agents."
				: "",
	},
	{ scope: SHELL },
);
app.attach();
tutuca.mount();

// ---- Dropping files -------------------------------------------------------------------------

const droppingClasses = UI.dropping.split(" ");
document.addEventListener("dragover", (e) => {
	if (!dragsFiles(e)) return;
	e.preventDefault();
	root.classList.add(...droppingClasses);
});
document.addEventListener("dragleave", (e) => {
	if (e.relatedTarget === null) root.classList.remove(...droppingClasses);
});
document.addEventListener("drop", async (e) => {
	if (!dragsFiles(e)) return;
	e.preventDefault();
	root.classList.remove(...droppingClasses);
	for (const file of e.dataTransfer.files) {
		try {
			// An agent's package installs; any other JSON document opens with an agent.
			const text = await file.text();
			if (parsePackage(text) !== null) await app.dropPackage(text);
			else app.dropJson(JSON.parse(text));
		} catch (error) {
			tutuca.send("say", [`${file.name}: ${error.message}`]);
		}
	}
});
