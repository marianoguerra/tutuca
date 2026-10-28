// The studio's library, kept in IndexedDB (tutuca-wax-studio): components
// (a .tcd and a .wax, and what was last built from them), scopes (a tree,
// each with the components registered in it and the names they go by) and
// screens (a scope and the layout made in it, as hydrate reads it). A bundle
// is the library as JSON, without the builds, to export and import.
//
//   component: { id, name, tcd, wax, build?: { key, wasm, types, ok } }
//   scope:     { id, name, parent, registrations: [{ component, names }] }
//   screen:    { id, name, scope, layout }
//
// A registration's component is a component's id or "prebuilt:<module>", a
// module of dist/components/; its names map the names the module registers
// to the ones used here, null for one left out (loadComponent's names).

const DB = "tutuca-wax-studio";
const KINDS = ["components", "scopes", "screens"];
export const BUNDLE_FORMAT = "tutuca-wax-studio";
export const BUNDLE_VERSION = 1;

const request = (r) =>
	new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});

export async function openStore() {
	const open = indexedDB.open(DB, 1);
	open.onupgradeneeded = () => {
		for (const kind of KINDS) open.result.createObjectStore(kind, { keyPath: "id" });
	};
	const db = await request(open);
	const tx = (kind, mode) => db.transaction(kind, mode).objectStore(kind);
	const store = {
		all: (kind) => request(tx(kind, "readonly").getAll()),
		put: (kind, record) => request(tx(kind, "readwrite").put(record)),
		delete: (kind, id) => request(tx(kind, "readwrite").delete(id)),
		clear: async () => {
			for (const kind of KINDS) await request(tx(kind, "readwrite").clear());
		},
		// The whole library, each kind a Map by id.
		load: async () => Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, new Map((await store.all(k)).map((r) => [r.id, r]))]))),
	};
	return store;
}

// The library as a bundle: what's needed to build it all again.
export const toBundle = (lib) => ({
	format: BUNDLE_FORMAT,
	version: BUNDLE_VERSION,
	components: [...lib.components.values()].map(({ id, name, tcd, wax }) => ({ id, name, tcd, wax })),
	scopes: [...lib.scopes.values()],
	screens: [...lib.screens.values()],
});

// A bundle's records by kind, or an error saying why it isn't one.
export function fromBundle(bundle) {
	if (bundle?.format !== BUNDLE_FORMAT) throw new Error("not a tutuca-wax studio bundle");
	if (bundle.version !== BUNDLE_VERSION) throw new Error(`a bundle of version ${bundle.version}; this studio reads version ${BUNDLE_VERSION}`);
	return Object.fromEntries(KINDS.map((k) => [k, Array.isArray(bundle[k]) ? bundle[k] : []]));
}
