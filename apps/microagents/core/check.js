// Checks an agent message the way the app will use it: its manifest and query, its module
// (loaded and defined with kit), its samples (each but "empty" matches the query, and every one
// decodes and re-encodes to the same bytes) and its tools (each message tool is a handler on
// the root, taking as many arguments as it lists). Returns the items, each { ok, label, detail },
// plus the definition and a scope with its components, for a preview.
import { canQuery, Scope } from "../../../src/tutuca.js";
import { defineAgent } from "./load-module.js";
import { EMPTY_SAMPLE, unpackAgent } from "./pack.js";
import { encodeMessage, queries } from "./tdata.js";
import { handlerOf } from "./tool-schema.js";

const item = (ok, label, detail = "") => ({ ok, label, detail });
const reason = (error) => error?.message ?? String(error);

export const checkAgent = async (msg, kit) => {
	const items = [];
	const out = (ok) => ({ ok, items, def: null, scope: null, parts: null, ...ok });
	let parts;
	try {
		parts = unpackAgent(msg);
		items.push(
			item(true, "the message is an agent", `${parts.manifest.id}: ${parts.manifest.title}`),
		);
	} catch (error) {
		items.push(item(false, "the message is an agent", reason(error)));
		return out({ ok: false });
	}
	const { manifest, samples, tools } = parts;
	let queryOk = true;
	try {
		queries.parse(manifest.query);
		items.push(item(true, "the query parses"));
	} catch (error) {
		queryOk = false;
		items.push(item(false, "the query parses", reason(error)));
	}
	let def;
	try {
		def = await defineAgent(parts.module, kit);
		items.push(
			item(
				true,
				"the module defines an agent",
				`root ${def.root}, components ${Object.keys(def.components).join(", ")}`,
			),
		);
	} catch (error) {
		items.push(item(false, "the module defines an agent", reason(error)));
		return out({ ok: false, parts });
	}
	const scope = new Scope(() => {});
	scope.register(def.components);
	scope.registerAskHandlers(def.asks ?? {});
	const C = scope.components;
	if (!samples.some((s) => s.id === EMPTY_SAMPLE))
		items.push(item(false, `a sample named "${EMPTY_SAMPLE}"`, "New opens it"));
	let emptyRoot = null;
	for (const { id, message } of samples) {
		let bindings = {};
		if (id !== EMPTY_SAMPLE && queryOk) {
			const found = queries.match(manifest.query, message);
			items.push(
				item(
					found !== undefined,
					`sample ${id} matches the query`,
					found ? [...found.bindings.keys()].map((k) => `$${k}`).join(" ") : "no match",
				),
			);
			if (found) bindings = Object.fromEntries(found.bindings);
		}
		try {
			const root = def.decode(C, bindings, message);
			if (id === EMPTY_SAMPLE) emptyRoot = root;
			const same = encodeMessage(def.encode(root, message)) === encodeMessage(message);
			items.push(
				item(
					same,
					`sample ${id} decodes and re-encodes to the same bytes`,
					same ? "" : "encode(decode(sample)) differs",
				),
			);
		} catch (error) {
			items.push(item(false, `sample ${id} decodes and re-encodes`, reason(error)));
		}
	}
	const root = emptyRoot ?? null;
	for (const tool of tools) {
		const params = tool.params ?? [];
		if (tool.kind === "message") {
			const spec = root && handlerOf(root, tool.name);
			const ok =
				spec !== undefined &&
				spec !== null &&
				(spec.args === undefined || spec.args.length === params.length);
			items.push(
				item(
					ok,
					`tool ${tool.name}: a handler on ${def.root}`,
					ok
						? ""
						: spec
							? `the handler takes ${spec.args.length} arguments, the tool lists ${params.length}`
							: "no such handler",
				),
			);
		} else if (tool.kind === "view") {
			const ok = root !== null && canQuery(root, tool.name);
			items.push(item(ok, `tool ${tool.name}: a query of ${def.root}`, ok ? "" : "no such query"));
		} else if (tool.kind === "module") {
			const ok = typeof def.tools?.[tool.name] === "function";
			items.push(
				item(ok, `tool ${tool.name}: a function in the module's tools`, ok ? "" : "not found"),
			);
		} else
			items.push(
				item(false, `tool ${tool.name}`, `kind must be message, view or module, not ${tool.kind}`),
			);
	}
	if (root !== null && !(canQuery(root, "summary") && typeof root.summary === "string"))
		items.push(item(false, `${def.root} has a summary query`, "the system prompt shows it"));
	return out({ ok: items.every((i) => i.ok), def, scope, parts });
};

// The report as text, failures first.
export const reportText = (items) =>
	[...items]
		.sort((a, b) => Number(a.ok) - Number(b.ok))
		.map((i) => `${i.ok ? "ok  " : "FAIL"} ${i.label}${i.detail ? `: ${i.detail}` : ""}`)
		.join("\n");
