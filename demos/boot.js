// Boots a demo: a dev Host on #app with the components, the browser's ask handlers (or
// askHandlers) and a root. The page's ?sync= picks engines that keep or sync the state (see
// sync/engines.js); then the root is what they stored, or make's when they have nothing, and
// the host starts once they've loaded.
import { compile } from "margaui";
import { isoDay } from "../components/common/calendar.js";
import { readText, saveFile } from "../components/common/files.js";
import { ClassCompiler, classNamesOf } from "../src/css/classes.js";
import { startSynced } from "../src/sync/index.js";
import { DispatchPath, Host, Target, Task } from "../src/tutuca.js";
import { SYNC_MODES, syncFromQuery, syncModeOf } from "./sync/engines.js";

export const boot = ({
	components,
	askHandlers = browserHandlers,
	make,
	document = globalThis.document,
}) => {
	const { host, watch } = setup({ components, askHandlers, document });
	const window = document.defaultView;
	const mode = window === null ? null : syncModeOf(window);
	addSyncSwitcher(document, mode);
	if (mode === null) {
		host.start(make(host.scope.components));
		watch();
		return host;
	}
	syncFromQuery(window, { log: addSyncLog(document) })
		.then((engines) => startSynced(host, { engines, make }))
		.then(watch)
		.catch((error) => console.error("sync failed to start", error));
	return host;
};

// Links in the demo bar to reload the page with each sync mode.
const addSyncSwitcher = (document, mode) => {
	const bar = document.querySelector(".demo-bar");
	if (bar === null) return;
	const nav = document.createElement("nav");
	nav.className = "sync-modes";
	nav.append("Sync:");
	for (const [value, label] of [[null, "off"], ...Object.entries(SYNC_MODES)]) {
		const url = new URL(document.defaultView.location.href);
		url.searchParams.delete("doc");
		if (value === null) url.searchParams.delete("sync");
		else url.searchParams.set("sync", value);
		const link = document.createElement("a");
		link.href = url.search === "" ? url.pathname : url.search;
		link.textContent = label;
		if (value === mode) link.setAttribute("aria-current", "page");
		nav.append(" ", link);
	}
	bar.append(nav);
};
// A list under the app for the ops that sync.
const addSyncLog = (document) => {
	const section = document.createElement("section");
	section.className = "sync-log";
	const title = document.createElement("h2");
	title.textContent = "What syncs";
	const list = document.createElement("ol");
	section.append(title, list);
	document.getElementById("app").after(section);
	return list;
};

const setup = ({ components, askHandlers, document }) => {
	const rootNode = document.getElementById("app");
	const host = new Host({ document, rootNode, dev: true });
	host.scope.register(components);
	host.scope.registerAskHandlers(askHandlers);
	const styleNode = document.getElementById("margaui");
	// Classes computed in methods escape classNamesOf; the compiler adds them as they render.
	const classes = styleNode === null ? null : new ClassCompiler(compile, []);
	host.onNotify = (type, info) => {
		if (type === "render") classes?.scan(rootNode);
		if (type === "taskFailed" || type === "stateInvalid" || type === "syncFailed") {
			console.error(type, info);
		}
	};
	const watch = () => {
		if (classes === null) return;
		for (const c of classNamesOf(Object.values(components))) classes.seen.add(c);
		classes.watch(rootNode, styleNode);
		classes.update().catch((error) => console.error("margaui compile failed", error));
	};
	return { host, watch };
};

// Sends name(...args) to the root component, as if it came from outside the app.
export const sendRoot = (host, name, args = []) => {
	const path = new DispatchPath();
	const task = new Task(name, args, path, new Target(path), null);
	host.prepareTask(task, host.rootComponent);
	host.pushTask(task);
};

// Ask handlers backed by the browser.
export const browserHandlers = {
	saveFile,
	readText,
	today: () => isoDay(new Date()),
	now: () => Date.now(),
	wait: ([ms, id]) => new Promise((resolve) => setTimeout(() => resolve(id), ms)),
};
