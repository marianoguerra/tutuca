// A pretend backend in a worker: a relay that orders the tabs' changes, persisted in
// IndexedDB under the key in its URL (one per demo). A SharedWorker serves every tab of the
// origin on that URL, so they sync through it; a plain Worker (where SharedWorker is missing)
// serves its one tab. Replies come after a delay, like a network's.
import { relay } from "../../src/sync/remote.js";

const params = new URL(self.location.href).searchParams;
const KEY = params.get("key") ?? "default";
const LATENCY_MS = Number(params.get("latency") ?? 120);
const later = (fn) => setTimeout(fn, LATENCY_MS);

const request = (req) =>
	new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
const openDb = () => {
	const req = indexedDB.open("tutuca-sync-backend", 1);
	req.onupgradeneeded = () => req.result.createObjectStore("state");
	return request(req);
};
const ready = openDb().then(async (db) => {
	const store = (mode) => db.transaction("state", mode).objectStore("state");
	const stored = await request(store("readonly").get(KEY));
	const save = (state) => store("readwrite").put(state, KEY);
	return relay({ ...(stored ?? {}), save });
});

const ports = new Set();
const serve = (port) => {
	ports.add(port);
	port.onmessage = ({ data }) =>
		later(async () => {
			const remote = await ready;
			if (data.type === "load") {
				port.postMessage({ type: "loaded", id: data.id, state: remote.load() });
			} else if (data.type === "push") {
				const message = remote.receive(data.batch);
				for (const p of ports) later(() => p.postMessage({ type: "message", message }));
			} else if (data.type === "close") ports.delete(port);
		});
};
if ("onconnect" in self) self.onconnect = (e) => serve(e.ports[0]);
else serve(self);
