// Sync engines: a host tells each one about the changes it commits (host.attachSync) and an
// engine applies changes from elsewhere through the link it's attached with. An engine is
//   { level: "shared" | "local", load?(), attach?(link), prepare?(change), commit(change, prepared),
//     detach?() }
// where level picks the fields it sees, load returns its stored projection to start from,
// change is { prev, next, task }, prepare does the work that can fail on the change itself (a
// throw fails the task before any engine wrote it) and commit writes what prepare returned.
// opsOf gives a change's ops, project its projection.

import { overlay, project } from "./codec.js";
import { reportMigration } from "./engine.js";
import { rebuild } from "./migrate.js";

export { hydrate, overlay, project } from "./codec.js";
export { diff, textSplice } from "./diff.js";
export { applyProjection, applyStateOps, opsOf, rootOps } from "./engine.js";
export { applyFitting, carry, rebuild, specChanges, writeFitting } from "./migrate.js";
export { applyOps, OpConflictError, opFits, opText } from "./ops.js";

// Starts host with the root its engines stored, or make(C) when none did: the "local" engines'
// projections first, the "shared" ones on top. Then attaches the engines.
export const startSynced = async (host, { engines, make }) => {
	const byLevel = [...engines].sort((a, b) =>
		a.level === "local" ? -1 : b.level === "local" ? 1 : 0,
	);
	const stored = await Promise.all(byLevel.map((e) => e.load?.() ?? null));
	const plain = stored.reduce(
		(acc, p, i) =>
			p === null ? acc : acc === null ? p : overlay(acc, p, host.scope, byLevel[i].level),
		null,
	);
	if (plain === null) host.start(make(host.scope.components));
	else {
		// Stored by this or another version of the components: what didn't fit is reported.
		const level = byLevel.some((e, i) => e.level === "local" && stored[i] !== null)
			? "local"
			: "shared";
		const rebuilt = rebuild(plain, host.scope, { level });
		host.start(rebuilt.root);
		reportMigration(rebuilt, (report) => host.report("migrated", { engine: null, ...report }));
	}
	host.attachSync(...engines);
	return host.root;
};

// The simplest engine: keeps the projection of every field but the "none" ones in storage (a
// Storage such as localStorage) under key, replacing it after each change.
export const storageEngine = (storage, key) => ({
	name: "storage",
	level: "local",
	load() {
		try {
			return JSON.parse(storage.getItem(key));
		} catch {
			return null;
		}
	},
	prepare: (change) => JSON.stringify(project(change.next, { level: "local" })),
	commit(_change, json) {
		storage.setItem(key, json);
	},
});
