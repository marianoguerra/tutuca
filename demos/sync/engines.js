// Sync for any demo, picked by the page's query: ?sync=local keeps the state in this browser,
// ?sync=worker syncs tabs through a pretend backend in a worker, ?sync=automerge syncs tabs
// through an Automerge document with no server, ?sync=relay syncs that document with other
// browsers through a public relay. The app doesn't know: boot attaches the engines.
import { storageEngine } from "../../src/sync/index.js";
import { logEngine } from "./log.js";

export const SYNC_MODES = {
	local: "this browser",
	worker: "worker",
	automerge: "Automerge",
	relay: "Automerge relay",
};
// The Automerge community's relay: for demos, with no uptime or privacy promises.
export const RELAY_URL = "wss://sync.automerge.org";
export const syncModeOf = (window) => {
	const mode = new URLSearchParams(window.location.search).get("sync");
	return Object.hasOwn(SYNC_MODES, mode) ? mode : null;
};

// A remoteEngine transport over a backend worker's port.
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

// The port of the backend for key: shared by the origin's tabs where SharedWorker exists.
export const backendPort = (window, key) => {
	const url = new URL(`./backend.js?key=${encodeURIComponent(key)}`, import.meta.url);
	if (typeof window.SharedWorker === "function") {
		const worker = new window.SharedWorker(url, { type: "module", name: `tutuca-sync:${key}` });
		window.addEventListener("pagehide", () => worker.port.postMessage({ type: "close" }));
		return worker.port;
	}
	return new window.Worker(url, { type: "module" });
};

// The handle of the document in the page's doc parameter, or of a new one put there. Tabs on
// the same address sync over a BroadcastChannel and keep it in IndexedDB; with a relay URL,
// other browsers on that address sync through it too.
export const repoHandle = async (window, { relay = null } = {}) => {
	const { isValidAutomergeUrl, Repo } = await import("@automerge/automerge-repo");
	const { BroadcastChannelNetworkAdapter } = await import(
		"@automerge/automerge-repo-network-broadcastchannel"
	);
	const { IndexedDBStorageAdapter } = await import("@automerge/automerge-repo-storage-indexeddb");
	const network = [new BroadcastChannelNetworkAdapter()];
	if (relay !== null) {
		const { BrowserWebSocketClientAdapter } = await import(
			"@automerge/automerge-repo-network-websocket"
		);
		network.push(new BrowserWebSocketClientAdapter(relay));
	}
	const repo = new Repo({
		network,
		storage: new IndexedDBStorageAdapter(
			relay === null ? "tutuca-sync-automerge" : "tutuca-sync-automerge-relay",
		),
	});
	const url = new URL(window.location.href);
	const doc = url.searchParams.get("doc");
	if (isValidAutomergeUrl(doc)) return repo.find(doc);
	const handle = repo.create();
	url.searchParams.set("doc", handle.url);
	window.history.replaceState(null, "", url);
	return handle;
};

// The engines the page's query asks for, or null without one. Each demo (key, its path) keeps
// its own state; every mode also keeps the "local" fields in the browser's storage. log, a
// list, shows the ops that sync. connect and open stand in for the worker and the repo.
export const syncFromQuery = async (
	window,
	{
		key = window.location.pathname,
		log = null,
		connect = backendPort,
		open = repoHandle,
		storage = window.localStorage,
	} = {},
) => {
	const mode = syncModeOf(window);
	if (mode === null) return null;
	const engines = [];
	if (mode === "worker") {
		const { remoteEngine } = await import("../../src/sync/remote.js");
		engines.push(remoteEngine({ transport: workerTransport(connect(window, key)) }));
	} else if (mode === "automerge" || mode === "relay") {
		const { automergeEngine } = await import("../../src/sync/automerge.js");
		const relay = mode === "relay" ? RELAY_URL : null;
		engines.push(automergeEngine({ handle: await open(window, { relay }) }));
	}
	engines.push(storageEngine(storage, `tutuca-sync:${mode}:${key}`));
	if (log !== null) engines.push(logEngine(log));
	return engines;
};
