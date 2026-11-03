// The micro-agents' page: the host of microagents.tcd's MicroAgents (app.js
// answers its asks), with the kit in the base scope, the shell in a child of
// its own and each agent in another, the built-in agents from
// dist/agents/, the installed ones from IndexedDB (store.js), files dropped
// on the page (a JSON document opens with an agent, a .wasm agent installs),
// and the models of the server (scripts/studio-server.mjs's /api/; a static
// host has none, and the chat can't run).
import { el, pageStyles } from "../js/page.js";
import { load, readBytes } from "../js/tutuca-rt.js";
import { createApp } from "./app.js";
import { defineChartElements } from "./elements.js";
import { httpClient } from "./llm.js";
import { openStore } from "./store.js";

const UI = {
	body: "bg-base-200 text-base-content",
	dropping: "outline-2 outline-dashed outline-primary -outline-offset-4",
};
const MODEL_KEY = "tutuca-wax-microagents:model";
const remembered = () => {
	try {
		return localStorage.getItem(MODEL_KEY) ?? "";
	} catch {
		return "";
	}
};

const styles = await pageStyles(Object.values(UI));
// The theme picked with the shell's toggle, kept in this browser; the
// system's until one is picked (pageStyles follows it, and a picked one
// stays put when the system's changes).
const THEME_KEY = "tutuca-wax-microagents:theme";
const pickedTheme = () => {
	try {
		return localStorage.getItem(THEME_KEY);
	} catch {
		return null;
	}
};
const applyTheme = (theme) => {
	if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
};
applyTheme(pickedTheme());
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(pickedTheme()));
document.body.className = UI.body;
defineChartElements();
const tw = await load(new URL("../dist/tutuca-rt.wasm", import.meta.url));
const { runtime } = tw;
const base = runtime.scope();
styles.add((await tw.loadComponent(new URL("../dist/components/microagent_kit.wasm", import.meta.url), base)).classes);
const shellScope = runtime.enter(base, "shell");
styles.add((await tw.loadComponent(new URL("../dist/components/microagents.wasm", import.meta.url), shellScope)).classes);

// The agents loaded at the start, built in or installed: none by default (a
// demo starts empty, and agents come in as their .wasm files are dropped),
// every one with ?loadAgents=all, or the ones a comma-separated list names
// (?loadAgents=regex-lab,jq-lab).
const wanted = new URLSearchParams(location.search).get("loadAgents") ?? "";
const loads =
	wanted.trim() === "all"
		? () => true
		: ((ids) => (id) => ids.has(id))(new Set(wanted.split(",").map((id) => id.trim()).filter(Boolean)));
const ids = (await (await fetch(new URL("../dist/agents/index.json", import.meta.url))).json()).filter(loads);
const builtins = await Promise.all(ids.map(async (id) => ({ id, bytes: new Uint8Array(await readBytes(new URL(`../dist/agents/${id}.wasm`, import.meta.url))) })));
const store = await openStore().catch(() => null);
const client = httpClient(new URL("../api/", import.meta.url));
const models = await client.models();
const values = models.map((m) => `${m.provider}/${m.id}`);
const model = values.includes(remembered()) ? remembered() : (values[0] ?? "");

const download = (name, text) => {
	const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name });
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const app = await createApp({
	tw,
	base,
	shellScope,
	client,
	store,
	builtins,
	loads,
	download,
	rememberModel: (m) => {
		try {
			localStorage.setItem(MODEL_KEY, m);
		} catch {}
	},
});
// The agents' classes, for the CSS (their views are in their modules).
for (const agent of app.agents.values()) styles.add(agent.classes ?? []);
app.setModel(model);

const root = document.querySelector("#app");
root.textContent = "";
const host = runtime.createHost(
	document,
	root,
	runtime.make(shellScope, "MicroAgents", {
		agents: app.agentRows(),
		sessions: [],
		models: models.map((m) => ({ value: `${m.provider}/${m.id}`, name: `${m.provider} · ${m.name}` })),
		model,
		theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
		status: models.length === 0 ? "No models: serve this page with `just microagents` (and API keys in .env) to chat with the agents." : "",
	}),
	{
		dev: true,
		asks: {
			...app.asks,
			set_theme: (theme) => {
				applyTheme(theme);
				try {
					localStorage.setItem(THEME_KEY, theme);
				} catch {}
				return true;
			},
		},
		onReport: (type, r) => {
			if (type === "taskFailed" || type === "renderFailed") console.error(type, r.error);
			if (type === "stateInvalid" || type === "messageInvalid") console.warn(type, r);
		},
	},
);
app.attach(host);
host.mount();

// ---- Dropping files -------------------------------------------------------------------

const dragsFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
document.addEventListener("dragover", (e) => {
	if (!dragsFiles(e)) return;
	e.preventDefault();
	root.classList.add(...UI.dropping.split(" "));
});
document.addEventListener("dragleave", (e) => {
	if (e.relatedTarget === null) root.classList.remove(...UI.dropping.split(" "));
});
document.addEventListener("drop", async (e) => {
	if (!dragsFiles(e)) return;
	e.preventDefault();
	root.classList.remove(...UI.dropping.split(" "));
	for (const file of e.dataTransfer.files) {
		try {
			if (file.name.endsWith(".wasm")) {
				const bytes = new Uint8Array(await file.arrayBuffer());
				const agent = await app.dropWasm(bytes);
				if (agent) styles.add(agent.classes ?? []);
			} else app.dropJson(JSON.parse(await file.text()));
		} catch (error) {
			host.send("say", [`${file.name}: ${error.message}`]);
		}
	}
});
