import { studio, studioComponents } from "../../components/json-schema/studio.js";
import { boot, sendRoot } from "../boot.js";

export const start = (document = globalThis.document) => {
	const host = boot({
		document,
		components: studioComponents,
		make: (C) => studio(C),
	});
	// Edits happen inside the editor, which doesn't tell the studio: infer after each one. Making
	// the editor notify would take a handler on every json component a notify bubbles through.
	host.listen((record) => {
		if (record.kind === "transition" && record.committed && host.root.isStale) {
			sendRoot(host, "regenerate");
		}
	});
	return host;
};

if (globalThis.document?.getElementById("app")) start();
