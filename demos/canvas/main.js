// The canvas demo, with a bundle of components picked by ?bundle= (bundles.js): its components
// are registered with the canvas's, its kinds answer what the holes can become, and its make
// is the canvas the page starts with. Without one, or with one that isn't known, it's the
// notebook's.
import { agentAskHandlers } from "../../components/agent/llm.js";
import { specOf } from "../../src/tutuca.js";
import { boot, browserHandlers } from "../boot.js";
import { BUNDLES, bundleFrom, bundleOf } from "./bundles.js";

// id, the bundle as ?bundle= names it (or a bundle, with the id of the one it stands for),
// handlers, ask handlers over the page's, and agent, as ?agent is, are for tests: a model or
// none, without a server.
export const start = (
	document = globalThis.document,
	id = undefined,
	handlers = {},
	agent = false,
) => {
	const bundle =
		typeof id === "object"
			? id
			: id === undefined
				? bundleOf(document.defaultView)
				: bundleFrom(id, agent);
	addBundleSwitcher(document, bundle);
	const agentHandlers = agentAskHandlers({ api: apiOf(document) });
	const host = boot({
		document,
		components: bundle.components,
		// Agents ask the studio server (tutuca-wax/scripts/studio-server.mjs) at ?api=.
		askHandlers: {
			...browserHandlers,
			...agentHandlers,
			models: preferModel(agentHandlers.models, modelOf(document)),
			...bundle.askHandlers,
			...handlers,
		},
		metaSchemas: bundle.metaSchemas,
		make: bundle.make,
	});
	// Once the canvas has started (synced, it starts later), it asks whether there's a model:
	// only then can its components be wrapped in agents. In an agent (the agent bundle), the
	// canvas is its target, and the agent asks which models there are.
	whenStarted(host, () => {
		const held = specOf(host.root)?.name === "Agent";
		if (held) host.send("loadModels", [], { now: true });
		const to = held ? (s) => s.field("target") : undefined;
		host.send("checkInference", [], { now: true, ...(to ? { to } : {}) });
	});
	rememberModel(document, host);
	return host;
};

// The model ?model= names, "provider/id", or null.
const modelOf = (document) =>
	new URLSearchParams(document.defaultView?.location.search ?? "").get("model") || null;
// models, with the one named first when it's among them: an agent that hasn't been given or
// picked one starts with the first the host offers, so a new agent opens with it.
export const preferModel = (models, id) => {
	if (id === null) return models;
	return async (...args) => {
		const all = await models(...args);
		if (!Array.isArray(all)) return all;
		const at = all.findIndex((m) => `${m.provider}/${m.id}` === id || m.id === id);
		return at <= 0 ? all : [all[at], ...all.slice(0, at), ...all.slice(at + 1)];
	};
};
// The model picked in an agent's select goes in ?model=, for the agents the page opens next,
// now and after a reload. Echo is no model to keep: picking it takes ?model= away.
const rememberModel = (document, host) => {
	const window = document.defaultView;
	if (!window?.history) return;
	host.listen((type, info) => {
		if (type !== "taskHandled" || info.task?.name !== "setModel") return;
		if (specOf(info.instance)?.name !== "Agent") return;
		const [model] = info.task.args;
		const url = new URL(window.location.href);
		if (typeof model !== "string" || model === "" || model.startsWith("echo/")) {
			url.searchParams.delete("model");
		} else url.searchParams.set("model", model);
		if (url.href === window.location.href) return;
		// A page whose URL can't be rewritten (about:blank) keeps it.
		try {
			window.history.replaceState(null, "", url);
		} catch {}
	});
};

const DEFAULT_API = "http://127.0.0.1:8003/api/";
// Where agents ask models: ?api=, else what the page says (scripts/app.js serves the API beside
// the demo and says /api/), else the studio server's.
const apiOf = (document) => {
	const query = new URLSearchParams(document.defaultView?.location.search ?? "").get("api");
	const meta = document.querySelector('meta[name="tutuca-api"]')?.getAttribute("content");
	const api = query ?? meta ?? DEFAULT_API;
	return new URL(api, document.defaultView?.location.href ?? "http://127.0.0.1/").href;
};
// Runs fn once host has a root.
const whenStarted = (host, fn, tries = 100) => {
	if (host.root !== null) fn();
	else if (tries > 0) setTimeout(() => whenStarted(host, fn, tries - 1), 50);
};

// The demo bar's title says the bundle, with links to the others (which keep the rest of the
// query, ?agent too) and one that puts the canvas in an agent, or takes it out.
const addBundleSwitcher = (document, bundle) => {
	const bar = document.querySelector(".demo-bar");
	if (bar === null) return;
	const title = bar.querySelector("h1");
	const added = bundle.agent && !BUNDLES[bundle.id].agent;
	if (title !== null) title.textContent = `Canvas · ${bundle.title}${added ? " + agent" : ""}`;
	const nav = document.createElement("nav");
	nav.className = "sync-modes canvas-bundles";
	const label = document.createElement("span");
	label.textContent = "Bundle";
	const options = document.createElement("span");
	options.className = "sync-options";
	nav.append(label, options);
	const here = () => new URL(document.defaultView?.location.href ?? "http://localhost/");
	const linkTo = (url, text) => {
		const link = document.createElement("a");
		// ?agent reads better without the = an empty value gets.
		const search = url.search.replace(/([?&]agent)=(?=&|$)/, "$1");
		link.href = search === "" ? url.pathname : search;
		link.textContent = text;
		return link;
	};
	for (const [id, { title }] of Object.entries(BUNDLES)) {
		const url = here();
		if (id === "default") url.searchParams.delete("bundle");
		else url.searchParams.set("bundle", id);
		const link = linkTo(url, title);
		if (id === bundle.id) link.setAttribute("aria-current", "page");
		options.append(link);
	}
	// The agent bundle comes in an agent; the others take ?agent.
	if (!BUNDLES[bundle.id].agent) {
		const url = here();
		if (added) url.searchParams.delete("agent");
		else url.searchParams.set("agent", "");
		const link = linkTo(url, "🤖 Agent");
		link.title = added
			? "Take the canvas out of its agent"
			: "Put the canvas in an agent of its own";
		if (added) link.setAttribute("aria-pressed", "true");
		options.append(link);
	}
	bar.append(nav);
};

if (globalThis.document?.getElementById("app")) start();
