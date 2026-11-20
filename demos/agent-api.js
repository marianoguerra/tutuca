// What the demos with agents share about where their models are: the inference API's URL and
// the model the page's URL names.
import { specOf } from "../src/tutuca.js";

const DEFAULT_API = "http://127.0.0.1:8003/api/";
// Where agents ask models: ?api=, else what the page says (scripts/app.js serves the API beside
// the demo and says /api/), else the studio server's.
export const apiOf = (document) => {
	const query = new URLSearchParams(document.defaultView?.location.search ?? "").get("api");
	const meta = document.querySelector('meta[name="tutuca-api"]')?.getAttribute("content");
	const api = query ?? meta ?? DEFAULT_API;
	return new URL(api, document.defaultView?.location.href ?? "http://127.0.0.1/").href;
};

// The model ?model= names, "provider/id", or null.
export const modelOf = (document) =>
	new URLSearchParams(document.defaultView?.location.search ?? "").get("model") || null;
// models, with the one named first when it's among them: an agent that hasn't been given or
// picked one starts with the first the host offers, so a new agent opens with it.
export const preferModel = (models, id) => {
	if (id === null) return models;
	return async (...args) => {
		const all = await models(...args);
		if (!Array.isArray(all)) return all;
		const at = all.findIndex((m) => `${m.provider}/${m.id}` === id || m.id === id);
		return at <= 0 ? all : [all[at], ...all.slice(0, at), ...all.slice(at + 1)];
	};
};
// The model picked in an agent's select goes in ?model=, for the agents the page opens next,
// now and after a reload, and to onPick when it's given. Echo is no model to keep: picking it
// takes ?model= away.
export const rememberModel = (document, host, onPick = null) => {
	const window = document.defaultView;
	host.listen((record) => {
		if (record.outcome !== "handled" || record.name !== "setModel") return;
		if (specOf(record.instance)?.name !== "Agent") return;
		const [model] = record.args;
		onPick?.(typeof model === "string" ? model : "");
		if (!window?.history) return;
		const url = new URL(window.location.href);
		if (typeof model !== "string" || model === "" || model.startsWith("echo/")) {
			url.searchParams.delete("model");
		} else url.searchParams.set("model", model);
		if (url.href === window.location.href) return;
		// A page whose URL can't be rewritten (about:blank) keeps it.
		try {
			window.history.replaceState(null, "", url);
		} catch {}
	});
};
