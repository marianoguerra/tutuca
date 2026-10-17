// Boots a demo: a dev Host on #app with the components, their ask handlers and a root.
import { compile } from "margaui";
import { ClassCompiler, classNamesOf } from "../src/dev/classes.js";
import { DispatchPath, Host, Target, Task } from "../src/tutuca.js";

export const boot = ({ components, askHandlers = {}, make, document = globalThis.document }) => {
	const rootNode = document.getElementById("app");
	const host = new Host({ document, rootNode, dev: true });
	host.scope.register(components);
	host.scope.registerAskHandlers(askHandlers);
	const styleNode = document.getElementById("margaui");
	// Classes computed in methods escape classNamesOf; the compiler adds them as they render.
	const classes = styleNode === null ? null : new ClassCompiler(compile, []);
	host.onNotify = (type, info) => {
		if (type === "render") classes?.scan(rootNode);
		if (type === "taskFailed" || type === "stateInvalid") console.error(type, info);
	};
	host.start(make(host.scope.components));
	if (classes !== null) {
		for (const c of classNamesOf(Object.values(components))) classes.seen.add(c);
		classes.watch(rootNode, styleNode);
		classes.update().catch((error) => console.error("margaui compile failed", error));
	}
	return host;
};

// Sends name(...args) to the root component, as if it came from outside the app.
export const sendRoot = (host, name, args = []) => {
	const path = new DispatchPath();
	const task = new Task(name, args, path, new Target(path), null);
	host.prepareTask(task, host.rootComponent);
	host.pushTask(task);
};

// Ask handlers backed by the browser.
const download = (filename, text, type) => {
	const doc = globalThis.document;
	if (doc?.createElement === undefined || globalThis.URL?.createObjectURL === undefined) return;
	const url = URL.createObjectURL(new Blob([text], { type }));
	Object.assign(doc.createElement("a"), { href: url, download: filename }).click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
};
const pad = (n) => String(n).padStart(2, "0");
export const browserHandlers = {
	// The third argument is a mime type (drawing) or a kind the caller wants back (tracker).
	saveFile: ([filename, text, typeOrKind]) => {
		download(filename, text, typeOrKind.includes("/") ? typeOrKind : "application/json");
		return typeOrKind;
	},
	readText: ([file]) => file.text(),
	today: () => {
		const d = new Date();
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	},
	now: () => Date.now(),
	wait: ([ms, id]) => new Promise((resolve) => setTimeout(() => resolve(id), ms)),
};
