// Boots a demo: a dev Host on #app with the components, the browser's ask handlers (or
// askHandlers) and a root. The page's ?sync= picks engines that keep or sync the state (see
// sync/engines.js); then the root is what they stored, or make's when they have nothing, and
// the host starts once they've loaded. A time travel bar under the demo bar records up to
// ?history= states (1000 when left out, none and no bar for 0).
import { compile } from "margaui";
import { isoDay } from "../components/common/calendar.js";
import { readText, saveFile } from "../components/common/files.js";
import { ClassCompiler, classNamesOf } from "../src/css/classes.js";
import { mountTimeTravel, TimeTravel } from "../src/history/bar.js";
import { startSynced } from "../src/sync/index.js";
import { DispatchPath, HOST, Host, Target, Task } from "../src/tutuca.js";
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
	if (window !== null) addTimeTravel(document, host, historyOf(window));
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
	const label = document.createElement("span");
	label.textContent = "Sync";
	const options = document.createElement("span");
	options.className = "sync-options";
	nav.append(label, options);
	for (const [value, label] of [[null, "off"], ...Object.entries(SYNC_MODES)]) {
		const url = new URL(document.defaultView.location.href);
		url.searchParams.delete("doc");
		if (value === null) url.searchParams.delete("sync");
		else url.searchParams.set("sync", value);
		const link = document.createElement("a");
		link.href = url.search === "" ? url.pathname : url.search;
		link.textContent = label;
		if (value === mode) link.setAttribute("aria-current", "page");
		options.append(link);
	}
	bar.append(nav);
};
// How many states ?history= keeps: 1000 when it's left out, 0 for none, null when it isn't a
// whole number.
export const historyOf = (window) => {
	const value = new URLSearchParams(window.location.search).get("history");
	if (value === null || value === "") return 1000;
	const n = Number(value);
	return Number.isInteger(n) && n >= 0 ? n : null;
};
// The time travel bar under the demo bar, recording host's states; nothing for 0.
const addTimeTravel = (document, host, max) => {
	if (max === 0) return;
	const bar = document.querySelector(".demo-bar");
	if (max === null) {
		const error = document.createElement("p");
		error.className = "demo-error";
		error.textContent = "?history= takes a whole number of states, 0 for no time travel.";
		bar?.append(error);
		return;
	}
	const rootNode = document.createElement("div");
	rootNode.className = "time-travel";
	if (bar === null) document.getElementById("app").before(rootNode);
	else bar.after(rootNode);
	mountTimeTravel({ document, rootNode, host, max });
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
		for (const c of classNamesOf([...Object.values(components), TimeTravel])) classes.seen.add(c);
		classes.watch(rootNode, styleNode);
		classes.update().catch((error) => console.error("margaui compile failed", error));
	};
	return { host, watch };
};

// Sends name(...args) to the root component, as if it came from outside the app.
export const sendRoot = (host, name, args = []) => {
	const task = new Task(name, args, HOST, new Target(new DispatchPath()), null);
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
