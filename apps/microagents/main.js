// The micro-agents app's page: the app on a dev host, its built-in agents fetched from
// agents/, installed agents and the chosen model kept in localStorage, and a model from the
// server that serves the page (server.js).
import { compile } from "margaui";
import { saveFile } from "../../components/common/files.js";
import { ClassCompiler, classNamesOf } from "../../src/css/classes.js";
import { DevChecks } from "../../src/tutuca.dev.js";
import { Host } from "../../src/tutuca.js";
import { AGENTS_URL, shellComponents, startApp } from "./app.js";
import { httpClient } from "./core/llm.js";

const readText = async (path) => {
	const res = await fetch(new URL(path, AGENTS_URL));
	if (!res.ok) throw new Error(`${path}: ${res.status}`);
	return res.text();
};

const KEY = "tutuca-microagents";
const load = () => {
	try {
		return JSON.parse(localStorage.getItem(KEY)) ?? {};
	} catch {
		return {};
	}
};
const keep = (change) => {
	const state = { agents: {}, ...load() };
	change(state);
	try {
		localStorage.setItem(KEY, JSON.stringify(state));
	} catch (error) {
		console.warn("couldn't keep the micro-agents state", error);
	}
};
export const localStore = {
	installed: () => Object.values(load().agents ?? {}),
	save: (id, text) => keep((s) => (s.agents[id] = text)),
	remove: (id) => keep((s) => delete s.agents[id]),
	model: () => load().model ?? null,
	setModel: (model) => keep((s) => (s.model = model)),
};

const saveBytes = (name, bytes, type) => {
	const url = URL.createObjectURL(new Blob([bytes], { type }));
	Object.assign(document.createElement("a"), { href: url, download: name }).click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
};
const files = { saveText: (name, text, type) => saveFile([name, text, type]), saveBytes };

// A dev host on #app; classes the components compute as they render compile into #margaui.
const makeHost = (document) => {
	const rootNode = document.getElementById("app");
	const host = new Host({ document, rootNode, checks: DevChecks });
	host.scope.register(shellComponents);
	const styleNode = document.getElementById("margaui");
	const classes = new ClassCompiler(compile, []);
	host.onNotify = (type, info) => {
		if (type === "render") classes.scan(rootNode);
		if (type === "taskFailed" || type === "stateInvalid") console.error(type, info);
	};
	const watch = () => {
		for (const c of classNamesOf(Object.values(shellComponents))) classes.seen.add(c);
		classes.watch(rootNode, styleNode);
		classes.update().catch((error) => console.error("margaui compile failed", error));
	};
	return { host, watch };
};

export const start = async (document = globalThis.document) => {
	const { host, watch } = makeHost(document);
	const llm = httpClient(new URL("/api/", document.location.href));
	await startApp({ host, readText, llm, store: localStore, files });
	watch();
	return host;
};

if (globalThis.document?.getElementById("app")) {
	start().catch((error) => console.error("the micro-agents app didn't start", error));
}
