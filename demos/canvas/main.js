// The canvas demo, with a bundle of components picked by ?bundle= (bundles.js): its components
// are registered with the canvas's, its kinds answer what the holes can become, and its make
// is the canvas the page starts with. Without one, or with one that isn't known, it's the
// notebook's.
import { agentAskHandlers } from "../../components/agent/llm.js";
import { withDefinedKinds } from "../../components/canvas/editor.js";
import { checkAsks, checkingTrailComponents } from "../../components/trail/check.js";
import { mountDrawer } from "../../components/trail/drawer.js";
import { attachTrail } from "../../components/trail/live.js";
import { tracesComponents } from "../../components/trail/traces.js";
import { AGENT_META, agentMetaOption } from "../../src/meta/index.js";
import { componentAsks } from "../../src/pure/define.js";
import { specOf } from "../../src/tutuca.js";
import { apiOf, modelOf, preferModel, rememberModel } from "../agent-api.js";
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
	// What component editors register: checked and registered where they are, their classes
	// compiled, and listed in the holes beside the bundle's kinds.
	const defined = new Set();
	const editorHandlers = componentAsks({
		host: () => host,
		// Every component an editor writes can be wrapped in an agent: its agent meta is what it
		// says over what its definition derives, checked as it's written.
		options: { meta: { [AGENT_META]: agentMetaOption("derive") } },
		// Only what's registered in the canvas's own scope is a kind; a preview's classes too.
		onDefine: (specs, scope) => {
			if (scope === host.scope) for (const spec of specs) defined.add(spec.name);
			host.classes?.add(specs);
		},
	});
	const host = boot({
		document,
		components: bundle.components,
		// Agents ask the studio server (tutuca-wasm/scripts/server.mjs) at ?api=.
		askHandlers: {
			...browserHandlers,
			...agentHandlers,
			models: preferModel(agentHandlers.models, modelOf(document)),
			...withDefinedKinds(bundle.askHandlers, defined),
			...editorHandlers,
			...handlers,
		},
		metaSchemas: bundle.metaSchemas,
		make: bundle.make,
		styled: [...Object.values(checkingTrailComponents), ...Object.values(tracesComponents)],
	});
	// The canvas's component tree and agents on it, in a drawer: read while it's open.
	const drawer = mountDrawer(document, {
		title: "Component tree",
		key: "tutuca-demos:canvas-tree",
	});
	const trail = attachTrail({
		document,
		host,
		treeNode: drawer.treeNode,
		tracesNode: drawer.tracesNode,
		onTraces: drawer.setTraces,
		components: checkingTrailComponents,
		askHandlers: {
			...agentHandlers,
			models: preferModel(agentHandlers.models, modelOf(document)),
			...handlers,
		},
		extraAsks: checkAsks,
		// A drag renders on every move: the tree is read once it stops for a moment.
		delay: 150,
		active: drawer.isOpen,
	});
	drawer.onOpen(() => trail.refresh({ stale: true }));
	rememberModel(document, trail.tree, (model) => trail.tree.send("useModel", [model]));
	host.trail = trail; // For tests: the tree's host and its refresh.
	// Once the canvas has started (synced, it starts later), it asks whether there's a model:
	// only then can its components be wrapped in agents. In an agent (the agent bundle), the
	// canvas is its target, and the agent asks which models there are.
	whenStarted(host, () => {
		const held = specOf(host.root)?.name === "Agent";
		if (held) host.send("loadModels", [], { now: true });
		const to = held ? "target" : undefined;
		host.send("checkInference", [], { now: true, ...(to ? { to } : {}) });
	});
	rememberModel(document, host);
	return host;
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
