import { storageEngine } from "../../src/sync/index.js";
import { remoteEngine } from "../../src/sync/remote.js";
import { bootSynced } from "../boot.js";
import { logEngine } from "../sync/log.js";
import { notesComponents } from "../sync/notes.js";

// A remoteEngine transport over the backend worker's port.
export const workerTransport = (port) => {
	const subscribers = new Set();
	const waiting = new Map();
	let ids = 0;
	port.onmessage = ({ data }) => {
		if (data.type === "loaded") {
			waiting.get(data.id)?.(data.state);
			waiting.delete(data.id);
		} else for (const fn of subscribers) fn(data.message);
	};
	return {
		push: (batch) => port.postMessage({ type: "push", batch }),
		subscribe(fn) {
			subscribers.add(fn);
			return () => subscribers.delete(fn);
		},
		load: () =>
			new Promise((resolve) => {
				ids++;
				waiting.set(ids, resolve);
				port.postMessage({ type: "load", id: ids });
			}),
	};
};

const backendPort = () => {
	const url = new URL("./backend.js", import.meta.url);
	if (typeof SharedWorker === "function") {
		const worker = new SharedWorker(url, { type: "module", name: "tutuca-persist-demo" });
		globalThis.addEventListener?.("pagehide", () => worker.port.postMessage({ type: "close" }));
		return worker.port;
	}
	return new Worker(url, { type: "module" });
};

export const start = (
	document = globalThis.document,
	{ port = backendPort(), storage = globalThis.localStorage } = {},
) =>
	bootSynced({
		document,
		components: notesComponents,
		rootRef: "Notes",
		engines: [
			remoteEngine({ transport: workerTransport(port) }),
			storageEngine(storage, "tutuca-persist-demo"),
			logEngine(document.getElementById("sync-log")),
		],
	});

if (globalThis.document?.getElementById("app")) {
	start().catch((error) => console.error("the demo failed to start", error));
}
