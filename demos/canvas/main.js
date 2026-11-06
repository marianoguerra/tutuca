// The canvas demo, with a bundle of components picked by ?bundle= (bundles.js): its components
// are registered with the canvas's, its kinds answer what the holes can become, and its make
// is the canvas the page starts with. Without one, or with one that isn't known, it's the
// notebook's.
import { agentAskHandlers } from "../../components/agent/llm.js";
import { boot, browserHandlers } from "../boot.js";
import { BUNDLES, bundleOf } from "./bundles.js";

// handlers, ask handlers over the page's, are for tests: a model or none, without a server.
export const start = (document = globalThis.document, id = undefined, handlers = {}) => {
	const bundle =
		id === undefined ? bundleOf(document.defaultView) : (BUNDLES[id] ?? BUNDLES.default);
	addBundleSwitcher(document, bundle);
	const host = boot({
		document,
		components: bundle.components,
		// Agents ask the studio server (tutuca-wax/scripts/studio-server.mjs) at ?api=.
		askHandlers: {
			...browserHandlers,
			...agentAskHandlers({ api: apiOf(document) }),
			...bundle.askHandlers,
			...handlers,
		},
		metaSchemas: bundle.metaSchemas,
		make: bundle.make,
	});
	// Once the canvas has started (synced, it starts later), it asks whether there's a model:
	// only then can its components be wrapped in agents.
	whenStarted(host, () => host.send("checkInference", [], { now: true }));
	return host;
};

const DEFAULT_API = "http://127.0.0.1:8003/api/";
const apiOf = (document) =>
	new URLSearchParams(document.defaultView?.location.search ?? "").get("api") ?? DEFAULT_API;
// Runs fn once host has a root.
const whenStarted = (host, fn, tries = 100) => {
	if (host.root !== null) fn();
	else if (tries > 0) setTimeout(() => whenStarted(host, fn, tries - 1), 50);
};

// The demo bar's title says the bundle, with links to the others.
const addBundleSwitcher = (document, bundle) => {
	const bar = document.querySelector(".demo-bar");
	if (bar === null) return;
	const title = bar.querySelector("h1");
	if (title !== null) title.textContent = `Canvas · ${bundle.title}`;
	const nav = document.createElement("nav");
	nav.className = "sync-modes canvas-bundles";
	const label = document.createElement("span");
	label.textContent = "Bundle";
	const options = document.createElement("span");
	options.className = "sync-options";
	nav.append(label, options);
	for (const [id, { title }] of Object.entries(BUNDLES)) {
		const url = new URL(document.defaultView?.location.href ?? "http://localhost/");
		if (id === "default") url.searchParams.delete("bundle");
		else url.searchParams.set("bundle", id);
		const link = document.createElement("a");
		link.href = url.search === "" ? url.pathname : url.search;
		link.textContent = title;
		if (BUNDLES[id] === bundle) link.setAttribute("aria-current", "page");
		options.append(link);
	}
	bar.append(nav);
};

if (globalThis.document?.getElementById("app")) start();
