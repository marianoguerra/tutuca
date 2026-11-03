// The installed agents, kept in IndexedDB (tutuca-wax-microagents): one
// record per agent, { id, wasm } (the packed module's bytes).

const DB = "tutuca-wax-microagents";

const request = (r) =>
	new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});

export async function openStore() {
	const open = indexedDB.open(DB, 1);
	open.onupgradeneeded = () => open.result.createObjectStore("agents", { keyPath: "id" });
	const db = await request(open);
	const tx = (mode) => db.transaction("agents", mode).objectStore("agents");
	return {
		all: () => request(tx("readonly").getAll()),
		put: (record) => request(tx("readwrite").put(record)),
		delete: (id) => request(tx("readwrite").delete(id)),
	};
}
