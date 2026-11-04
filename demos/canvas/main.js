// The canvas demo, with a bundle of components picked by ?bundle= (bundles.js): its components
// are registered with the canvas's, its kinds answer what the holes can become, and its make
// is the canvas the page starts with. Without one, or with one that isn't known, it's the
// notebook's.
import { boot, browserHandlers } from "../boot.js";
import { BUNDLES, bundleOf } from "./bundles.js";

export const start = (document = globalThis.document, id = undefined) => {
	const bundle =
		id === undefined ? bundleOf(document.defaultView) : (BUNDLES[id] ?? BUNDLES.default);
	addBundleSwitcher(document, bundle);
	return boot({
		document,
		components: bundle.components,
		askHandlers: { ...browserHandlers, ...bundle.askHandlers },
		metaSchemas: bundle.metaSchemas,
		make: bundle.make,
	});
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
