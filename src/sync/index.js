// Sync engines: a host tells each one about the changes it commits (host.attachSync) and an
// engine applies changes from elsewhere through the link it's attached with. An engine is
//   { level: "shared" | "local", load?(), attach?(link), commit(change), detach?() }
// where level picks the fields it sees, load returns its stored projection to start from, and
// change is { prev, next, task }. opsOf gives a change's ops, project its projection.

import { overlay, project } from "./codec.js";
import { diff } from "./diff.js";
import { applyFitting, rebuild } from "./migrate.js";

export { componentOf, hydrate, isRef, overlay, project, typeAt } from "./codec.js";
export { diff, textSplice } from "./diff.js";
export { applyFitting, carry, rebuild, specChanges } from "./migrate.js";
export { applyOps, OpConflictError, opText } from "./ops.js";

const memo = new WeakMap(); // change → level → ops
// The ops of a committed change at level, computed once for all the engines that ask.
export const opsOf = (change, level, scope) => {
	if (!memo.has(change)) memo.set(change, new Map());
	const byLevel = memo.get(change);
	if (!byLevel.has(level)) byLevel.set(level, diff(change.prev, change.next, { level, scope }));
	return byLevel.get(level);
};
// Applies plain ops to a state draft, made to fit this version's components (applyFitting):
// ops from a peer on another version keep the state valid. onMigrate(report) gets what that
// changed, { added, reset, dropped }, when it changed anything. Returns the root.
export const applyStateOps = (root, ops, scope, { level = "shared", onMigrate = null } = {}) => {
	const report = { added: [], reset: [], dropped: [] };
	for (const op of ops) root = applyFitting(root, op, scope, report, { level });
	if (onMigrate !== null && migrated(report)) onMigrate(report);
	return root;
};
// Whether a migration report changed anything.
export const migrated = ({ added, reset, dropped }) =>
	added.length + reset.length + dropped.length > 0;

// Starts host with the root its engines stored, or make(C) when none did: the "local" engines'
// projections first, the "shared" ones on top. Then attaches the engines.
export const startSynced = async (host, { engines, make }) => {
	const byLevel = [...engines].sort((a, b) =>
		a.level === "local" ? -1 : b.level === "local" ? 1 : 0,
	);
	const stored = await Promise.all(byLevel.map((e) => e.load?.() ?? null));
	const plain = stored.reduce(
		(acc, p) => (p === null ? acc : acc === null ? p : overlay(acc, p)),
		null,
	);
	if (plain === null) host.start(make(host.scope.components));
	else {
		// Stored by this or another version of the components: what didn't fit is reported.
		const level = byLevel.some((e, i) => e.level === "local" && stored[i] !== null)
			? "local"
			: "shared";
		const { root, added, reset, dropped } = rebuild(plain, host.scope, { level });
		host.start(root);
		const report = { added, reset, dropped };
		if (migrated(report)) host.notify("stateMigrated", { engine: null, ...report });
	}
	host.attachSync(...engines);
	return host.rootComponent;
};

// The simplest engine: keeps the projection of every field but the "none" ones in storage (a
// Storage such as localStorage) under key, replacing it after each change.
export const storageEngine = (storage, key) => ({
	level: "local",
	load() {
		try {
			return JSON.parse(storage.getItem(key));
		} catch {
			return null;
		}
	},
	commit(change) {
		storage.setItem(key, JSON.stringify(project(change.next, { level: "local" })));
	},
});
