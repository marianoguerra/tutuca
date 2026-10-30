// The tree spec's scenarios (exported by spec/tree/export.rkt into scenarios/), one at a time:
// ?s= picks one, the first when it's left out. The links above the app switch between them.
import { treeSpecComponents } from "../../components/tree-spec/index.js";
import { explorerOf } from "../../components/tree-spec/model.js";
import { boot } from "../boot.js";

const load = (name) => fetch(new URL(`./scenarios/${name}`, import.meta.url)).then((r) => r.json());

// The scenario links, the current one marked.
const addLinks = (document, index, current) => {
	const nav = document.querySelector(".tree-spec-scenarios");
	if (nav === null) return;
	for (const { name, tier, title, policy } of index) {
		const link = document.createElement("a");
		link.className = "tree-spec-link";
		link.href = `?s=${encodeURIComponent(name)}`;
		link.textContent = `${tier} · ${title}`;
		link.title = `policy: ${policy}`;
		if (name === current) link.setAttribute("aria-current", "page");
		nav.append(link);
	}
};

// Boots the explorer on scenario, the parsed JSON of one; in a page without one, it loads the
// index and the scenario ?s= names.
export const start = (document = globalThis.document, scenario = null) => {
	const run = (json) =>
		boot({ document, components: treeSpecComponents, make: (C) => explorerOf(C, json) });
	if (scenario !== null) return run(scenario);
	const asked = new URLSearchParams(document.defaultView.location.search).get("s");
	return load("index.json")
		.then((index) => {
			const name = index.some((s) => s.name === asked) ? asked : index[0].name;
			addLinks(document, index, name);
			return load(`${name}.json`).then(run);
		})
		.catch((error) => console.error("the tree spec scenarios failed to load", error));
};

if (globalThis.document?.getElementById("app")) void start();
