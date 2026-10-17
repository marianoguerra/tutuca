import { studio, studioComponents } from "../../components/jsonschema/studio.js";
import { boot, browserHandlers, sendRoot } from "../boot.js";

export const start = (document = globalThis.document) => {
	const host = boot({
		document,
		components: studioComponents,
		askHandlers: { saveFile: browserHandlers.saveFile },
		make: (C) => studio(C),
	});
	// Edits happen inside the editor, which doesn't tell the studio: infer after each one. Making
	// the editor notify would take a handler on every json component a notify bubbles through.
	const notify = host.onNotify;
	host.onNotify = (type, info) => {
		notify(type, info);
		if (type === "taskHandled" && host.rootComponent.isStale) {
			sendRoot(host, "regenerate");
		}
	};
	return host;
};

if (globalThis.document?.getElementById("app")) start();
