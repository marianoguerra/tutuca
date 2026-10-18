// Tabs sync with no server: automerge-repo sends changes between the tabs of this origin over
// a BroadcastChannel and keeps the document in IndexedDB. The document's URL is the page's
// hash, so a tab opened on the same address edits the same document.
import { isValidAutomergeUrl, Repo } from "@automerge/automerge-repo";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { automergeEngine } from "../../src/sync/automerge.js";
import { storageEngine } from "../../src/sync/index.js";
import { bootSynced } from "../boot.js";
import { logEngine } from "../sync/log.js";
import { notesComponents } from "../sync/notes.js";

const openHandle = (location) => {
	const repo = new Repo({
		network: [new BroadcastChannelNetworkAdapter()],
		storage: new IndexedDBStorageAdapter("tutuca-automerge-demo"),
	});
	const url = location.hash.slice(1);
	if (isValidAutomergeUrl(url)) return repo.find(url);
	const handle = repo.create();
	location.hash = handle.url;
	return Promise.resolve(handle);
};

export const start = async (document = globalThis.document, location = globalThis.location) => {
	const handle = await openHandle(location);
	return bootSynced({
		document,
		components: notesComponents,
		rootRef: "Notes",
		engines: [
			automergeEngine({ handle }),
			// The filter is kept per device, and per document: other hashes have their own.
			storageEngine(globalThis.localStorage, `tutuca-automerge-demo:${handle.url}`),
			logEngine(document.getElementById("sync-log")),
		],
	});
};

if (globalThis.document?.getElementById("app")) {
	start().catch((error) => console.error("the demo failed to start", error));
}
